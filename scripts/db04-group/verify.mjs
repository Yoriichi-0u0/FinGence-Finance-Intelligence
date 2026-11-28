// Offline verification only; no credentials, connection or database mutation.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync('docs/integration/db04-group-deployment-manifest.json','utf8'));
if(manifest.target.projectRef!=='zmtdozblpvtjniehwjrw'||manifest.target.database!=='postgres')throw Error('TARGET_MANIFEST_MISMATCH');
for(const input of manifest.inputs){
 const text=input.commit?execFileSync('git',['show',`${input.commit}:${input.file}`],{encoding:'utf8'}):readFileSync(input.file,'utf8');
 if(sha(text.replaceAll('\r\n','\n'))!==input.sha256)throw Error('SOURCE_CHECKSUM_MISMATCH');
}
for(const artifact of manifest.sql)if(sha(readFileSync(artifact.file))!==artifact.sha256)throw Error('REVIEWED_SQL_CHECKSUM_MISMATCH');
console.log(JSON.stringify({verified:true,target:manifest.target,sql:manifest.sql,hostedExecution:false}));
