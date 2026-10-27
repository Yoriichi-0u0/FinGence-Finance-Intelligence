import { afterAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RecoveryLab, sha256, verifyArchive, requireFresh, minimalEnvironment } from "../../scripts/db03/native.mjs";
import { verifyManifest } from "../../scripts/db01/integrity.mjs";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"fingence-db03-unit-"));
afterAll(()=>{
  const rel=path.relative(os.tmpdir(),root);
  if(!rel.startsWith("fingence-db03-unit-")||rel.includes("..")||/[\\/]/.test(rel))throw new Error("Unsafe unit cleanup");
  fs.rmSync(root,{recursive:true});
});
it("accepts an exact archive checksum",()=>{
  const file=path.join(root,"valid.dump");const bytes=Buffer.from("synthetic backup bytes\n");fs.writeFileSync(file,bytes);
  expect(()=>verifyArchive(file,sha256(bytes))).not.toThrow();
});
it("rejects content corruption and invalid expected hashes",()=>{
  const file=path.join(root,"changed.dump");fs.writeFileSync(file,"changed");
  expect(()=>verifyArchive(file,sha256(Buffer.from("original")))).toThrow("checksum mismatch");
  expect(()=>verifyArchive(file,"not-a-sha256")).toThrow("checksum mismatch");
});
it("does not normalize archive line endings to bypass integrity checks",()=>{
  const file=path.join(root,"crlf.dump");fs.writeFileSync(file,"synthetic\r\n");
  expect(()=>verifyArchive(file,sha256(Buffer.from("synthetic\n")))).toThrow("checksum mismatch");
});
it("requires a nonexistent recovery destination, even if an existing directory is empty",()=>{
  const empty=path.join(root,"existing");fs.mkdirSync(empty);
  expect(()=>requireFresh(empty)).toThrow("already exists");expect(()=>requireFresh(path.join(root,"new"))).not.toThrow();
});
it("does not inherit application credentials or default libpq credential configuration",()=>{
  const env=minimalEnvironment(root,"C:/test-binaries");
  expect(env).not.toHaveProperty("PGPASSWORD");expect(env).not.toHaveProperty("SUPABASE_DATABASE_URL");
  expect(env.PGPASSFILE).toBe(path.join(root,"empty-pgpass"));expect(env.PGSERVICEFILE).toBe(path.join(root,"empty-service"));
});
it("refuses backup operations on unowned source cluster objects before invoking PostgreSQL",async()=>{
  const lab={clusters:[]};
  await expect(RecoveryLab.prototype.logicalDump.call(lab,{port:5432},"unused")).rejects.toThrow("Unowned source cluster");
  expect(()=>RecoveryLab.prototype.baseBackup.call(lab,{port:5432},"unused")).toThrow("Unowned source cluster");
});
it("refuses a restore target not created by the laboratory",async()=>{
  await expect(RecoveryLab.prototype.logicalRestore.call({targets:new WeakSet()}, {}, "unused", "unused"))
    .rejects.toThrow("unused laboratory-created target");
});
it("never counts a failed subprocess launch as successful corruption detection",()=>{
  const lab={bin:path.join(root,"no-binaries"),root,env:minimalEnvironment(root,root),commands:[]};
  expect(()=>RecoveryLab.prototype.command.call(lab,"pg_restore",[],{failureExpected:true})).toThrow("could not complete");
});
it("checks the laboratory ownership marker and rejects paths outside its root",()=>{
  fs.writeFileSync(path.join(root,"db03-owner.json"),JSON.stringify({token:"synthetic-owner"}));
  const owned={root,token:"synthetic-owner"};
  expect(()=>RecoveryLab.prototype.assertOwned.call(owned,path.join(root,"owned"))).not.toThrow();
  expect(()=>RecoveryLab.prototype.assertOwned.call(owned,path.join(root,"..","unrelated"))).toThrow("outside laboratory");
  expect(()=>RecoveryLab.prototype.assertOwned.call({...owned,token:"wrong"},path.join(root,"owned"))).toThrow("marker mismatch");
});
it("verifies historical DB01 and DB02 evidence from exact committed Git blobs without rewriting checkout files",()=>{
  const revision="3637faa10fd1f42304d983ff5be420e9ec72dea8";
  for(const [folder,name,count,sources] of [
    ["docs/database/db01/2026-10-27T05-45-05-445Z","manifest.json",389,14],
    ["docs/database/db02/evidence","integrity-manifest.json",9,10],
  ] as const){
    const manifest=JSON.parse(execFileSync("git",["show",`${revision}:${folder}/${name}`],{encoding:"utf8"}));
    const files=[...Object.keys(manifest.artifacts).map(f=>folder+"/"+f),...Object.keys(manifest.sources)];
    const output=execFileSync("git",["cat-file","--batch"],{input:files.map(f=>revision+":"+f+"\n").join(""),maxBuffer:32*1024*1024});
    const blobs=new Map<string,Buffer>();let offset=0;
    for(const file of files){const end=output.indexOf(10,offset),match=/^[0-9a-f]+ blob (\d+)$/.exec(output.subarray(offset,end).toString());
      if(!match)throw new Error("Missing committed evidence blob");const size=Number(match[1]);blobs.set(file,output.subarray(end+1,end+1+size));offset=end+size+2;}
    expect(verifyManifest(manifest,{readArtifact:(f:string)=>blobs.get(folder+"/"+f),readSource:(f:string)=>blobs.get(f)}))
      .toEqual({artifacts:count,sources});
  }
});
