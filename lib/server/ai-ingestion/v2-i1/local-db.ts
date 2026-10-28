import "server-only";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { TransactionDatabase } from "../../db/postgres";

const markerName = ".fingence-v2-i1-local";
const markerValue = "fingence-v2-i1-local-schema-4\n";

/** Local, synthetic-only PGlite database. No path comes from a browser request. */
export async function openLocalDatabase(directory: string): Promise<TransactionDatabase> {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.FINGENCE_AI_LOCAL !== "1" || process.env.FINGENCE_V2_I1_LOCAL !== "1") throw new Error("LOCAL_ONLY");
  const root = resolve(".local"), target = resolve(directory), subpath = relative(root, target);
  if (!subpath || subpath === ".." || subpath.startsWith(`..${sep}`) || isAbsolute(subpath)) throw new Error("LOCAL_DATABASE_PATH");
  await mkdir(root, { mode: 0o700, recursive: true });
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("LOCAL_DATABASE_PATH");
  let current = root;
  for (const part of subpath.split(sep)) {
    current = resolve(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("LOCAL_DATABASE_PATH");
  }
  const marker = resolve(target, markerName);
  const contents = await readdir(target);
  let initializedHere = false;
  if (contents.length === 0) {
    await writeFile(marker, markerValue, { mode: 0o600, flag: "wx" });
    initializedHere = true;
  } else {
    const stat = await lstat(marker);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0 || (await readFile(marker, "utf8")) !== markerValue) throw new Error("LOCAL_DATABASE_MARKER");
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
  instance ??= openLocalDatabase(resolve(".local/v2-i1-database-v4"));
  return instance;
}

/** Explicitly release the process-owned test/demo connection. */
export async function closeLocalDatabase(): Promise<void> {
  const current = instance;
  instance = undefined;
  if (current) await (await current).close();
}
