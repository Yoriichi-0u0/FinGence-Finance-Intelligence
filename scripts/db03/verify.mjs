import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { hashBytes, hashSource, HASH_CONVENTION, verifyManifest } from '../db01/integrity.mjs';

const mode=process.argv[2];
if(process.argv.length>3 || (mode!==undefined && !['--write-manifest','--staged'].includes(mode)))throw new Error('Usage: node scripts/db03/verify.mjs [--write-manifest|--staged]');
const root='docs/database/db03', evidence=root+'/evidence', manifestFile=root+'/integrity-manifest.json';
function walk(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(directory,item.name)):[path.join(directory,item.name).replaceAll('\\','/')]);
}
if(mode==='--write-manifest') {
  const artifacts=walk(evidence).sort();
  if(artifacts.some(f=>!f.endsWith('.json')))throw new Error('Only sanitized JSON evidence/backup metadata belongs in the evidence directory');
  const sourceFiles=[...walk('scripts/db03'),...walk('tests/recovery'),...fs.readdirSync(root).filter(f=>f.endsWith('.md')||f==='.gitattributes').map(f=>root+'/'+f),
    'supabase/sql/phase1-clean-setup.sql','supabase/sql/phase1-source-file-upgrade.sql','supabase/sql/c3b1-grouped-persistence-upgrade.sql',
    'supabase/sql/db02-001-warning-mutation-fence.sql','tests/persistence/fixtures.ts','scripts/db01/integrity.mjs',
    'lib/server/db/postgres.ts','lib/server/persistence/repository.ts','lib/server/persistence/grouped.ts'];
  if(fs.existsSync(manifestFile)) {
    const old=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    for(const [file,hash] of Object.entries(old.artifacts))assert.equal(hashBytes(fs.readFileSync(evidence+'/'+file)),hash,'Previously recorded evidence changed: '+file);
  }
  const successful=fs.readdirSync(evidence,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort().filter(name=>{
    const file=evidence+'/'+name+'/runner.json';if(!fs.existsSync(file))return false;
    const run=JSON.parse(fs.readFileSync(file));return run.regressions===true && run.exitCode===0;
  });
  assert(successful.length>0,'No successful combined native/regression run');
  fs.writeFileSync(manifestFile,JSON.stringify({hashConvention:HASH_CONVENTION,
    sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),authoritativeRun:successful.at(-1),
    artifacts:Object.fromEntries(artifacts.map(f=>[path.relative(evidence,f).replaceAll('\\','/'),hashBytes(fs.readFileSync(f))])),
    sources:Object.fromEntries(sourceFiles.sort().map(f=>[f,hashSource(fs.readFileSync(f))]))},null,2));
}
const gitRead=file=>execFileSync('git',['show',':'+file],{maxBuffer:8*1024*1024});
const manifest=JSON.parse(mode==='--staged'?gitRead(manifestFile):fs.readFileSync(manifestFile));
let blobs;
if(mode==='--staged') {
  const files=[...Object.keys(manifest.artifacts).map(f=>evidence+'/'+f),...Object.keys(manifest.sources)];
  if(files.some(f=>/[\r\n]/.test(f)))throw new Error('Invalid evidence path');
  const output=execFileSync('git',['cat-file','--batch'],{input:files.map(f=>':'+f+'\n').join(''),maxBuffer:32*1024*1024});
  blobs=new Map();let offset=0;
  for(const file of files){const end=output.indexOf(10,offset),m=/^[0-9a-f]+ blob (\d+)$/.exec(output.subarray(offset,end).toString());
    if(!m)throw new Error('Missing staged evidence/source: '+file);const n=Number(m[1]);blobs.set(file,output.subarray(end+1,end+1+n));offset=end+n+2;}
}
const read=file=>mode==='--staged'?blobs.get(file):fs.readFileSync(file);
const retained=mode==='--staged'?execFileSync('git',['ls-files','--',root],{encoding:'utf8'}).trim().split('\n'):walk(root);
if(retained.some(f=>!f.endsWith('/.gitattributes')&&!/\.(md|json)$/.test(f)))throw new Error('Unexpected raw/binary artifact in DB03 documentation');
const hashes=verifyManifest(manifest,{readArtifact:f=>read(evidence+'/'+f),readSource:read});
const run=evidence+'/'+manifest.authoritativeRun;
const tests=JSON.parse(read(run+'/vitest.json')), recovery=JSON.parse(read(run+'/recovery.json'));
assert.equal(tests.numFailedTests,0);assert.equal(tests.numPendingTests,0);assert(tests.numPassedTests>=548);
assert.equal(recovery.cleanup.removed,true);assert.deepEqual(recovery.cleanup.failures,[]);
for(const name of ['logical','physical','pitr']) {
  assert.deepEqual(recovery.verifications[name].tables,(name==='pitr'?recovery.boundary:recovery.source).tables);
  assert.equal(recovery.verifications[name].schemaSHA256,recovery.source.schemaSHA256);
  assert(Object.values(recovery.verifications[name].orphans).every(n=>n===0));
  assert(recovery.verifications[name].audit.every(a=>a.violations===0));
}
const lsn=value=>{const [high,low]=value.split('/');return (BigInt('0x'+high)<<32n)+BigInt('0x'+low);};
assert.equal(recovery.pitr.replay.recovering,false);
assert(lsn(recovery.pitr.replay.replay_lsn)>=lsn(recovery.pitr.restoreLSN));
assert(lsn(recovery.pitr.replay.replay_lsn)<lsn(recovery.pitr.afterCommitLSN));
assert.equal(hashBytes(read(run+'/physical-backup-manifest.json')),recovery.measurements.physicalBackup.manifestSHA256);
assert.equal(recovery.measurements.physicalBackup.verifyExitCode,0);
assert(/^[0-9a-f]{64}$/.test(recovery.measurements.logicalBackup.sha256));
console.log(JSON.stringify({mode:mode||'working-tree',...hashes,authoritativeRun:manifest.authoritativeRun,tests:tests.numPassedTests,
  logicalPhysicalPitr:'verified',promotionComplete:true,rawBackupFilesInRepository:false}));
