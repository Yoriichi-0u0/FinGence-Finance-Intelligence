import { mkdirSync, lstatSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Create-only private reports; no environment variables or credentials are serialized. */
export function prepareI2ReportDestination() {
 const root=resolve('.ai-local'),folder=join(root,'increment-i2');
 for(const p of [root,folder]) {mkdirSync(p,{mode:0o700,recursive:true});const s=lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory()||(s.mode&0o077)!==0||(process.getuid&&s.uid!==process.getuid()))throw new Error('UNSAFE_REPORT_DIRECTORY');}
 const probe=join(folder,`.probe-${randomUUID()}`); const fd=openSync(probe,'wx',0o600);try { writeFileSync(fd,'probe'); } finally { closeSync(fd); unlinkSync(probe); }
 return folder;
}
export function saveI2Report(report, summary) {
 const folder=prepareI2ReportDestination();
 const id=randomUUID(), json=join(folder,`${id}.json`), text=join(folder,`${id}.txt`);
 for(const [path,data] of [[json,JSON.stringify(report,null,2)+'\n'],[text,summary]]) {const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,data);}finally{closeSync(fd);}}
 return {json:relative(process.cwd(),json),text:relative(process.cwd(),text)};
}
