import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=process.cwd();
const m=JSON.parse(fs.readFileSync(path.join(root,'docs/reconciliation/ai03-integrity-manifest.json'),'utf8'));
if(m.algorithm!=='SHA-256'||m.sourcesConvention!=='crlf-to-lf-v1'||m.artifactsConvention!=='byte-exact')throw new Error('Unsupported manifest convention');
let count=0;
for(const kind of ['sources','artifacts'])for(const [file,expected]of Object.entries(m[kind])){
 const p=path.resolve(root,file);if(!p.startsWith(root+path.sep))throw new Error('Manifest path outside repository');
 const raw=fs.readFileSync(p),bytes=kind==='sources'?Buffer.from(raw.toString('utf8').replace(/\r\n/g,'\n')):raw;
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Integrity mismatch: '+file);count++;
}
console.log(`Verified ${count} AI03 source/reference/artifact hashes. Model weights remain external and are checked by the loader.`);
