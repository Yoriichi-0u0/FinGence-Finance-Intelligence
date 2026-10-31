import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=process.cwd(),dir='docs/reconciliation/evidence/ai05/official/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(path.resolve(root,p),'utf8'));
const canonical=value=>{
 const sort=v=>Array.isArray(v)?v.map(sort):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;
 return JSON.stringify(sort(value),null,2)+'\n';
};
const fail=message=>{throw new Error(message);};
const frozen=read(dir+'freeze.json'),{fingerprint,...body}=frozen;
if(sha(canonical(body))!==fingerprint)fail('Freeze fingerprint mismatch');
for(const [file,expected]of Object.entries(frozen.sources))if(sha(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'))!==expected)fail('Frozen source drift: '+file);
for(const [file,expected]of Object.entries(frozen.artifacts))if(sha(fs.readFileSync(file))!==expected)fail('Frozen artifact drift: '+file);
const seal=read(dir+'prediction-seal.json');
if(seal.phase!=='PREDICTIONS_FROZEN_BEFORE_TRUTH'||seal.truthLoaded!==false||sha(fs.readFileSync(dir+'freeze.json'))!==seal.freezeSHA256||sha(fs.readFileSync(dir+'predictions.json'))!==seal.predictionsSHA256)fail('Prediction seal mismatch');
const pred=read(dir+'predictions.json');
if(pred.truthLoaded!==false||pred.freezeFingerprint!==fingerprint)fail('Prediction/configuration mismatch');
for(const row of pred.results){
 const {fingerprint:verifiedHash,...verifiedBody}=row.verification;
 if(sha(canonical(verifiedBody))!==verifiedHash)fail('Verification fingerprint mismatch');
 if(row.warm.some(w=>w.runFingerprint!==row.run.fingerprint||w.verificationFingerprint!==verifiedHash))fail('Warm replay mismatch');
}
if(fs.existsSync(dir+'evaluation.json')){
 const evaluation=read(dir+'evaluation.json'),{fingerprint:evaluationHash,...evaluationBody}=evaluation;
 if(sha(canonical(evaluationBody))!==evaluationHash||evaluation.predictionsSHA256!==seal.predictionsSHA256||evaluation.freezeFingerprint!==fingerprint)fail('Evaluation fingerprint/link mismatch');
}
if(process.argv.includes('--model'))for(const [file,expected]of Object.entries(frozen.model.filesSHA256))if(sha(fs.readFileSync(path.join(frozen.modelRoot,file)))!==expected)fail('Model hash mismatch: '+file);
const manifestPath='docs/reconciliation/ai05-integrity-manifest.json';
if(fs.existsSync(manifestPath)){
 const m=read(manifestPath);
 if(m.sourcesConvention!=='crlf-to-lf-v1'||m.artifactsConvention!=='byte-exact')fail('Unsupported package hash convention');
 for(const kind of ['sources','artifacts'])for(const [file,expected]of Object.entries(m[kind])){
  const resolved=path.resolve(root,file);if(!resolved.startsWith(root+path.sep))fail('Path outside repository');
  const bytes=kind==='sources'?Buffer.from(fs.readFileSync(resolved,'utf8').replace(/\r\n/g,'\n')):fs.readFileSync(resolved);
  if(sha(bytes)!==expected)fail('Package integrity mismatch: '+file);
 }
}
console.log('AI05 freeze, unchanged sources, sealed predictions, replay fingerprints and available evaluation/package hashes verified. No truth JSON parsed.');
