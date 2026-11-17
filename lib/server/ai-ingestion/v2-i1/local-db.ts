import "server-only";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { TransactionDatabase } from "../../db/postgres";

const markerName = ".fingence-v2-i1-local";
const markerValue = "fingence-v2-i1-local-schema-5\n";

/** Windows reports ACL-backed files through approximate POSIX mode bits. Check the real ACL instead. */
function assertWindowsPrivateAcl(path: string) {
  const script = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$acl=Get-Acl -LiteralPath $env:FINGENCE_LOCAL_ACL_TARGET
$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if($owner -ne $current){throw 'OWNER'}
$unsafe=@('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546','S-1-5-4','S-1-5-7','S-1-5-14')
$modify=[System.Security.AccessControl.FileSystemRights]::Modify
$hasModify=$false
foreach($rule in $acl.Access){
  $sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $unsafe -contains $sid){throw 'BROAD_ACCESS'}
  if($sid -eq $current -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($rule.FileSystemRights -band $modify) -eq $modify)){$hasModify=$true}
}
if(-not $hasModify){throw 'CURRENT_USER_ACCESS'}
[Console]::Out.Write('OK')`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, FINGENCE_LOCAL_ACL_TARGET: path },
  });
  if (result !== "OK") throw new Error("LOCAL_DATABASE_PATH");
}

function assertPrivatePath(path: string, stat: Awaited<ReturnType<typeof lstat>>, directory: boolean) {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error("LOCAL_DATABASE_PATH");
  if (process.platform === "win32") {
    try { assertWindowsPrivateAcl(path); } catch { throw new Error("LOCAL_DATABASE_PATH"); }
  } else if ((Number(stat.mode) & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error("LOCAL_DATABASE_PATH");
  }
}

/** Local, synthetic-only PGlite database. No path comes from a browser request. */
export async function openLocalDatabase(directory: string): Promise<TransactionDatabase> {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.FINGENCE_AI_LOCAL !== "1" || process.env.FINGENCE_V2_I1_LOCAL !== "1") throw new Error("LOCAL_ONLY");
  const root = resolve(".local"), target = resolve(directory), subpath = relative(root, target);
  if (!subpath || subpath === ".." || subpath.startsWith(`..${sep}`) || isAbsolute(subpath)) throw new Error("LOCAL_DATABASE_PATH");
  await mkdir(root, { mode: 0o700, recursive: true });
  const rootStat = await lstat(root);
  assertPrivatePath(root, rootStat, true);
  let current = root;
  for (const part of subpath.split(sep)) {
    current = resolve(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = await lstat(current);
    assertPrivatePath(current, stat, true);
  }
  const marker = resolve(target, markerName);
  const contents = await readdir(target);
  let initializedHere = false;
  if (contents.length === 0) {
    await writeFile(marker, markerValue, { mode: 0o600, flag: "wx" });
    initializedHere = true;
  } else {
    const stat = await lstat(marker);
    assertPrivatePath(marker, stat, false);
    if ((await readFile(marker, "utf8")) !== markerValue) throw new Error("LOCAL_DATABASE_MARKER");
  }
  const db = await PGlite.create(target);
  try {
    const exists = await db.query<{ present: boolean }>("SELECT to_regclass('fingence_v2_local.attempts') IS NOT NULL AS present");
    if (initializedHere) {
      if (exists.rows[0]?.present) throw new Error("LOCAL_DATABASE_SCHEMA");
      await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
      await db.exec(await readFile(resolve("supabase/sql/v2-verified-document-local.sql"), "utf8"));
    } else if (!exists.rows[0]?.present) throw new Error("LOCAL_DATABASE_SCHEMA");
    return { close: async () => { await db.close(); }, transaction: async work => db.transaction(async tx => work({
      async query(sql, values) {
        const result = await tx.query(sql, values);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length } as never;
      },
    })) };
  } catch (error) { await db.close(); throw error; }
}

let instance: Promise<TransactionDatabase> | undefined;
export function localDatabase(): Promise<TransactionDatabase> {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.FINGENCE_AI_LOCAL !== "1" || process.env.FINGENCE_V2_I1_LOCAL !== "1") throw new Error("LOCAL_ONLY");
  instance ??= openLocalDatabase(resolve(".local/v2-i1-database-v5"));
  return instance;
}

/** Explicitly release the process-owned test/demo connection. */
export async function closeLocalDatabase(): Promise<void> {
  const current = instance;
  instance = undefined;
  if (current) await (await current).close();
}
