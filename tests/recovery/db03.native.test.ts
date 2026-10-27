import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { RecoveryLab, sha256, verifyArchive, requireFresh } from "../../scripts/db03/native.mjs";
import { syntheticResult, header, validRow } from "../persistence/fixtures";
import { transactionDatabase, type TransactionDatabase } from "../../lib/server/db/postgres";
import { createGroupedPersistenceService } from "../../lib/server/persistence/grouped";
import { createTransactionQueryService } from "../../lib/server/api/transaction-query";
import { createTransactionDetailQueryService } from "../../lib/server/api/transaction-detail-query";
import { createBatchQueryService } from "../../lib/server/api/batch-query";
import { snapshot, snapshotEvidence } from "./verification";

const bin = process.env.DB03_PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const available = fs.existsSync(path.join(bin,"pg_verifybackup.exe"));
if (process.env.DB03_REQUIRED === "1" && !available) throw new Error("Native PostgreSQL recovery tools unavailable");
const ids = { seed:"30000000-0000-4000-8000-000000000001", rollback:"30000000-0000-4000-8000-000000000002",
  before:"30000000-0000-4000-8000-000000000003", after:"30000000-0000-4000-8000-000000000004" };

describe.skipIf(!available)("DB03 native PostgreSQL backup and recovery", () => {
  let lab: RecoveryLab, source: Awaited<ReturnType<RecoveryLab["createCluster"]>>;
  let sourcePool: Pool, logical: Pool, physical: Pool, pitr: Pool;
  let target: Awaited<ReturnType<RecoveryLab["freshDatabase"]>>;
  let base: string, dump: string, dumpHash: string;
  let original: Awaited<ReturnType<typeof snapshot>>, boundary: typeof original;
  let ready = false, failed = false;
  const evidence: Record<string, unknown> = { syntheticOnly:true, attempts:ids, measurements:{}, tools:{}, verifications:{} };
  const measurements = evidence.measurements as Record<string, unknown>;
  const verifications = evidence.verifications as Record<string, unknown>;
  function save() {
    if (process.env.DB03_EVIDENCE) fs.writeFileSync(path.join(process.env.DB03_EVIDENCE,"recovery.json"),JSON.stringify({ ...evidence, commands:lab?.commands || [] },null,2));
  }
  const service = (pool: Pool) => createGroupedPersistenceService(transactionDatabase(pool));
  function restored(name: string): Pool {
    if(name==="logical")return logical;if(name==="physical")return physical;if(name==="pitr")return pitr;
    throw new Error("Unknown recovery target");
  }
  async function appendGroup(pool: Pool, id: string, label: string) {
    const result = await syntheticResult(`${header}\n${validRow.replace("00017",label)}`,{},
      { batchId:`synthetic-db03-${label}`,ingestedAt:"2026-10-27T00:00:00Z" }, `${label}.csv`);
    return service(pool).persistGroupedAttempt({ attempt_id:id,results:[result] });
  }
  beforeAll(async () => {
    lab = new RecoveryLab(bin);
    try {
      const space = fs.statfsSync(lab.root);
      if (space.bavail * space.bsize < 1024 * 1024 * 1024) throw new Error("At least 1 GiB free temporary storage is required");
      for (const tool of ["pg_dump","pg_restore","pg_basebackup","pg_verifybackup"]) {
        const version = lab.command(tool,["--version"]); expect(version.stdout).toContain("18.6");
        (evidence.tools as Record<string,unknown>)[tool] = version.stdout.trim();
      }
      source = await lab.createCluster("source"); sourcePool = await lab.pool(source);
      evidence.environment={version:(await sourcePool.query("SELECT version() version")).rows[0].version,
        settings:(await sourcePool.query("SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','wal_segment_size','fsync','synchronous_commit','full_page_writes','archive_mode','archive_library') ORDER BY name")).rows};
      await sourcePool.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
      for (const file of ["phase1-clean-setup.sql","c3b1-grouped-persistence-upgrade.sql","db02-001-warning-mutation-fence.sql"]) {
        await sourcePool.query(fs.readFileSync(new URL(`../../supabase/sql/${file}`,import.meta.url),"utf8"));
      }
      const csv = `${header}\n${validRow}\n${validRow.replace("MYR","MYRR")}\n${validRow.replace("2026-09-01","invalid")}`;
      const signed = await syntheticResult(csv,{},undefined,"synthetic-signed.csv");
      const ledger = await syntheticResult("transaction_date,debit,credit,amount,balance,reference,description,currency\n2026-09-01,9007199254740993.1,2.000000001,-99.123456789,9007199254740999.123456789,R,Synthetic,MYR",{monetaryMode:"debit_credit"},undefined,"synthetic-ledger.csv");
      const directed = await syntheticResult("transaction_date,posting_date,amount,entry_side,reference,currency\n2026-09-01,2026-09-03,125.500000001,DEBIT,R,",{monetaryMode:"amount_direction",dateBasis:"posting_date"},undefined,"synthetic-directed.csv");
      const empty = await syntheticResult(`${header}\n${validRow.replace("2026-09-01","invalid")}`,{},undefined,"synthetic-empty.csv");
      await service(sourcePool).persistGroupedAttempt({attempt_id:ids.seed,results:[signed,ledger,directed,empty]});
      // A real rollback after the grouped writer's work has run, before COMMIT.
      const real = transactionDatabase(sourcePool);
      const rollbackDb: TransactionDatabase = { close:async()=>{}, transaction:work => real.transaction(async c => { await work(c); throw new Error("Synthetic rollback injection"); }) };
      await expect(createGroupedPersistenceService(rollbackDb).persistGroupedAttempt({attempt_id:ids.rollback,results:[signed]})).rejects.toMatchObject({code:"PERSISTENCE_FAILED"});
      original = await snapshot(sourcePool);
      evidence.source = snapshotEvidence(original);
      const roles = await lab.createCluster("logical-target");
      const admin = await lab.pool(roles);
      await admin.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
      target = await lab.freshDatabase(roles,"db03_logical"); logical=target.pool;
      dump=lab.child("logical.dump");
      const backup=await lab.logicalDump(source,dump); dumpHash=backup.sha256;
      measurements.logicalBackup={durationMs:backup.durationMs,bytes:backup.bytes,sha256:dumpHash,exitCode:backup.exitCode};
      const logicalStart=performance.now();const restore=await lab.logicalRestore(target,dump,dumpHash);
      const logicalSnapshot=await snapshot(logical);expect(logicalSnapshot.data).toEqual(original.data);expect(logicalSnapshot.schema).toEqual(original.schema);
      measurements.logicalRestore={durationMs:restore.durationMs,verifiedDurationMs:performance.now()-logicalStart,exitCode:restore.exitCode};
      verifications.logical=snapshotEvidence(logicalSnapshot);
      const physicalBackup=lab.baseBackup(source,"base-backup"); base=physicalBackup.dest;
      const verified=lab.verifyBase(base);
      measurements.physicalBackup={durationMs:physicalBackup.result.durationMs,...lab.treeSize(base),exitCode:physicalBackup.result.exitCode,
        manifestSHA256:sha256(fs.readFileSync(path.join(base,"backup_manifest"))),verifyExitCode:verified.exitCode,verifyDurationMs:verified.durationMs};
      if(process.env.DB03_EVIDENCE)fs.copyFileSync(path.join(base,"backup_manifest"),path.join(process.env.DB03_EVIDENCE,"physical-backup-manifest.json"));
      const physicalRecovery=await lab.recover(base,"physical-target");physical=await lab.pool(physicalRecovery.cluster);
      const physicalVerifyStart=performance.now();const physicalSnapshot=await snapshot(physical);
      expect(physicalSnapshot.data).toEqual(original.data);expect(physicalSnapshot.schema).toEqual(original.schema);
      measurements.physicalRecovery={durationMs:physicalRecovery.durationMs,verifiedDurationMs:physicalRecovery.durationMs+performance.now()-physicalVerifyStart};
      verifications.physical=snapshotEvidence(physicalSnapshot);
      await appendGroup(sourcePool,ids.before,"before-target");boundary=await snapshot(sourcePool);
      const restoreName="db03_verified_boundary";
      const restoreLSN=(await sourcePool.query("SELECT pg_create_restore_point($1)::text lsn",[restoreName])).rows[0].lsn;
      await appendGroup(sourcePool,ids.after,"after-target");
      const afterLSN=(await sourcePool.query("SELECT pg_current_wal_flush_lsn()::text lsn")).rows[0].lsn;
      const segment=(await sourcePool.query("SELECT pg_walfile_name(pg_current_wal_insert_lsn()) segment")).rows[0].segment;
      await sourcePool.query("SELECT pg_switch_wal()");
      const deadline=Date.now()+15000;
      while(!fs.existsSync(path.join(lab.archive,segment)) && Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      expect(fs.existsSync(path.join(lab.archive,segment))).toBe(true);
      const pitrStart=performance.now();const recovery=await lab.recover(base,"pitr-target",restoreName);pitr=await lab.pool(recovery.cluster);
      measurements.pitrRecovery={durationMs:performance.now()-pitrStart};
      const replay=(await pitr.query("SELECT pg_is_in_recovery() recovering,pg_last_wal_replay_lsn()::text replay_lsn")).rows[0];
      evidence.pitr={restoreName,restoreLSN,afterCommitLSN:afterLSN,replay,archiveFiles:fs.readdirSync(lab.archive).length,
        archiveBytes:lab.treeSize(lab.archive).bytes,
        logEvidence:fs.readFileSync(lab.child("pitr-target.log"),"utf8").split(/\r?\n/).filter(l=>/recovery stopping|restore point|archive recovery complete|selected new timeline/.test(l))};
      const pitrSnapshot=await snapshot(pitr);expect(pitrSnapshot.data).toEqual(boundary.data);expect(pitrSnapshot.schema).toEqual(original.schema);
      (measurements.pitrRecovery as Record<string,unknown>).verifiedDurationMs=performance.now()-pitrStart;
      evidence.boundary=snapshotEvidence(boundary);verifications.pitr=snapshotEvidence(pitrSnapshot);
      ready=true; save();
    } catch(error) { evidence.setupFailure=String(error);evidence.diagnostics=lab.root;save();throw error; }
  },300000);
  afterEach(({task})=>{if(task.result?.state==="fail")failed=true;});
  afterAll(async()=>{if(lab){evidence.cleanup=await lab.cleanup(ready&&!failed);save();}},60000);

  it("logical restore preserves complete deterministic row data, counts and grouped identities",async()=>{
    const recovered=await snapshot(logical);expect(recovered.data).toEqual(original.data);
    expect(recovered.data.persistence_attempts).toHaveLength(1);expect(recovered.data.ingestion_batches).toHaveLength(4);
    expect(recovered.data.financial_records).toHaveLength(4);expect(recovered.data.validation_issues.length).toBeGreaterThan(0);
  });
  it.each(["logical","physical","pitr"])("%s preserves schema, ownership, ACLs, RLS, functions and active triggers",async name=>{
    const recovered=await snapshot(restored(name));expect(recovered.schema).toEqual(original.schema);
    expect(recovered.orphans).toEqual({records:0,issues:0,batches:0});expect(recovered.audit.every(r=>r.violations===0)).toBe(true);
    expect(recovered.schema.triggers.some(t=>t.tgname==="issue_00_warning_mutation_fence"&&t.tgenabled==="O")).toBe(true);
  });
  it.each(["logical","physical","pitr"])("%s retains exact money, NULLs, date bases, accepted statuses and source lineage",async name=>{
    const pool=restored(name);
    const signed=(await pool.query("SELECT source_amount::text amount,balance,source_file,source_transaction_id FROM public.financial_records WHERE source_file='synthetic-signed.csv' ORDER BY ingestion_status")).rows;
    expect(signed).toHaveLength(2);expect(signed.every(r=>r.amount==="9007199254740993.123456789"&&r.balance===null&&r.source_transaction_id==="00042")).toBe(true);
    const ledger=(await pool.query("SELECT debit::text,credit::text,source_amount::text,derived_ledger_net::text,balance::text FROM public.financial_records WHERE source_file='synthetic-ledger.csv'")).rows[0];
    expect(ledger).toEqual({debit:"9007199254740993.1",credit:"2.000000001",source_amount:"-99.123456789",derived_ledger_net:"9007199254740991.099999999",balance:"9007199254740999.123456789"});
    expect((await pool.query("SELECT currency,currency_basis,canonical_date_basis,to_char(canonical_date,'YYYY-MM-DD') AS canonical_day FROM public.financial_records WHERE source_file='synthetic-directed.csv'")).rows[0])
      .toEqual({currency:null,currency_basis:null,canonical_date_basis:"POSTING_DATE",canonical_day:"2026-09-03"});
    expect((await pool.query("SELECT count(*)::int n FROM public.ingestion_batches WHERE status='COMPLETED_EMPTY' AND valid_count=0 AND warning_count=0 AND completed_at IS NOT NULL")).rows[0].n).toBe(1);
  });
  it("physical backup verifies, starts in a separate directory and matches the base snapshot",async()=>{
    expect((await snapshot(physical)).data).toEqual(original.data);
    expect((await physical.query("SELECT pg_is_in_recovery() recovery")).rows[0].recovery).toBe(false);
  });
  it("PITR includes the before-target group and excludes the after-target committed group",async()=>{
    expect((await pitr.query("SELECT pg_is_in_recovery() recovering")).rows[0].recovering).toBe(false);
    expect((await snapshot(pitr)).data).toEqual(boundary.data);
    expect(await service(pitr).investigateAttempt(ids.before)).toMatchObject({outcome:"CONFIRMED_COMMITTED"});
    expect(await service(pitr).investigateAttempt(ids.after)).toMatchObject({outcome:"CONFIRMED_NOT_COMMITTED"});
    expect(await service(sourcePool).investigateAttempt(ids.after)).toMatchObject({outcome:"CONFIRMED_COMMITTED"});
    const point=evidence.pitr as {restoreLSN:string;afterCommitLSN:string;logEvidence:string[]};
    expect((await pitr.query("SELECT pg_last_wal_replay_lsn()>=$1::pg_lsn AND pg_last_wal_replay_lsn()<$2::pg_lsn boundary",[point.restoreLSN,point.afterCommitLSN])).rows[0].boundary).toBe(true);
    expect(point.logEvidence.some(l=>l.includes("db03_verified_boundary"))).toBe(true);
  });
  it.each(["logical","physical","pitr"])("%s excludes the rolled-back attempt and enforces restored warning constraints",async name=>{
    const pool=restored(name);expect(await service(pool).investigateAttempt(ids.rollback)).toMatchObject({outcome:"CONFIRMED_NOT_COMMITTED"});
    await expect(pool.query("DELETE FROM public.validation_issues")).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("UPDATE public.financial_records SET source_amount='NaN'::numeric WHERE monetary_basis='source_signed_amount'")).rejects.toMatchObject({code:"23514"});
  });
  it("checksum mismatch rejects a separate corrupted archive copy before any restore",async()=>{
    const copy=lab.child("corrupt.dump");fs.copyFileSync(dump,copy);const bytes=fs.readFileSync(copy);bytes[12]^=255;fs.writeFileSync(copy,bytes);
    expect(()=>verifyArchive(copy,dumpHash)).toThrow("checksum mismatch");expect(()=>verifyArchive(dump,dumpHash)).not.toThrow();
    const bad=await lab.freshDatabase(target.cluster,"db03_bad_checksum");const commandCount=lab.commands.length;
    await expect(lab.logicalRestore(bad,copy,dumpHash)).rejects.toThrow("checksum mismatch");expect(lab.commands.length).toBe(commandCount);
  });
  it("truncated logical archive is rejected by both checksum and PostgreSQL tooling",()=>{
    const copy=lab.child("truncated.dump");fs.writeFileSync(copy,fs.readFileSync(dump).subarray(0,12));
    expect(()=>verifyArchive(copy,dumpHash)).toThrow();expect(lab.command("pg_restore",["--list",copy],{failureExpected:true}).exitCode).not.toBe(0);
  });
  it("restoration command failure rolls back all restored objects in a fresh failure-only database",async()=>{
    const bad=await lab.freshDatabase(target.cluster,"db03_restore_failure");
    const result=await lab.logicalRestore(bad,dump,dumpHash,["--role=db03_role_does_not_exist"]);expect(result.exitCode).not.toBe(0);
    expect((await bad.pool.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")).rows[0].n).toBe(0);
  });
  it("fresh-target guards refuse existing directories and a previously restored database",async()=>{
    expect(()=>requireFresh(source.data)).toThrow("already exists");
    await expect(lab.logicalRestore(target,dump,dumpHash)).rejects.toThrow("unused laboratory-created target");
    expect((await snapshot(logical)).data).toEqual(original.data);
  });
  it("pg_verifybackup rejects a corrupted disposable physical copy",()=>{
    const copy=lab.copyFresh(base,"corrupt-base");const manifest=JSON.parse(fs.readFileSync(path.join(copy,"backup_manifest"),"utf8"));
    const entry=manifest.Files.find((f:{Path:string;Size:number})=>f.Path.startsWith("base/")&&f.Size>0);
    const file=path.join(copy,entry.Path);lab.assertOwned(file);const bytes=fs.readFileSync(file);bytes[0]^=255;fs.writeFileSync(file,bytes);
    expect(lab.verifyBase(copy,true).exitCode).not.toBe(0);expect(lab.verifyBase(base).exitCode).toBe(0);
  });
  it("pg_verifybackup rejects an incomplete physical copy without its manifest",()=>{
    const copy=lab.copyFresh(base,"incomplete-base");fs.unlinkSync(path.join(copy,"backup_manifest"));
    expect(lab.verifyBase(copy,true).exitCode).not.toBe(0);
  });
  it.each(["logical","physical","pitr"])("%s remains compatible with existing transaction and batch query/investigation services",async name=>{
    const pool=restored(name), batchIds=(await pool.query("SELECT id FROM public.ingestion_batches ORDER BY id")).rows.map(r=>r.id);
    const access={subjectId:"synthetic-db03",organizationId:"synthetic-lab",scopeVersion:"v1",batchIds};
    const transactions=createTransactionQueryService({database:pool,resolveAccess:async()=>access,auditRead:async()=>true,
      cursors:{issue:async()=>"synthetic",verify:async()=>{throw new Error("No cursor input in this probe");}}});
    const page=await transactions.list(new URLSearchParams("limit=100"),null);expect(page.items.length).toBe(name==="pitr"?5:4);
    const details=createTransactionDetailQueryService({database:pool,resolveAccess:async()=>access,audit:async()=>true});
    expect(await details.get(page.items[0].transaction_id,null)).toEqual(page.items[0]);
    const batches=createBatchQueryService({database:pool,resolveAccess:async()=>access,audit:async()=>true,
      cursors:{issue:async()=>"synthetic",verify:async()=>{throw new Error("No cursor input in this probe");}}});
    expect((await batches.list(new URLSearchParams("limit=100"),null)).items).toHaveLength(name==="pitr"?5:4);
    expect(await batches.get(batchIds[0],null)).not.toBeNull();
    expect(await service(pool).investigateAttempt(ids.seed)).toMatchObject({outcome:"CONFIRMED_COMMITTED"});
    // These new writes occur only after the restored-snapshot/boundary assertions.
    const probeId={logical:"30000000-0000-4000-8000-000000000006",physical:"30000000-0000-4000-8000-000000000007",pitr:"30000000-0000-4000-8000-000000000008"}[name]!;
    const receipt=await appendGroup(pool,probeId,`restored-${name}-probe`);
    expect(receipt.datasets[0].accepted_record_count).toBe(1);
    expect(await service(pool).investigateAttempt(probeId)).toMatchObject({outcome:"CONFIRMED_COMMITTED"});
    const probes=(evidence.writerProbes||={}) as Record<string,unknown>;
    probes[name]={attemptId:probeId,accepted:1,outcome:"CONFIRMED_COMMITTED",afterSnapshotVerification:true};save();
  });
  it.each(["logical","physical","pitr"])("%s preserves effective anonymous/client denial, not only ACL catalog text",async name=>{
    const c=await restored(name).connect();
    try {
      for(const role of ["anon","authenticated"]) {
        await c.query(`SET ROLE ${role}`);
        await expect(c.query("SELECT * FROM public.financial_records")).rejects.toMatchObject({code:"42501"});
        await c.query("RESET ROLE");
      }
    } finally {await c.query("RESET ROLE");c.release();}
  });
});
