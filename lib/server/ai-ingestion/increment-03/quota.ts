import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const entry = z.strictObject({ id: z.string().uuid(), at: z.number().int().nonnegative(), tokens: z.number().int().positive().max(8000),
  state: z.enum(["RESERVED", "COMPLETED", "FAILED", "UNKNOWN"]), usage: z.strictObject({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).nullable() });
const schema = z.strictObject({ version: z.literal("quota-0.3"), entries: z.array(entry).max(64) });
type State = z.infer<typeof schema>;
export const QUOTA = Object.freeze({ rpm: 30, rpd: 1000, tpm: 8000, tpd: 160000, attempts: 64 });
export class QuotaLedger {
  readonly folder: string;
  constructor(folder: string, private clock = Date.now) { this.folder = resolve(folder); }
  private safePath() {
    if (existsSync(this.folder) && lstatSync(this.folder).isSymbolicLink()) throw new Error("QUOTA_SYMLINK");
    for (const name of ["quota.json", "quota.lock"]) if (existsSync(join(this.folder, name)) && lstatSync(join(this.folder, name)).isSymbolicLink()) throw new Error("QUOTA_SYMLINK");
  }
  private read(): State {
    this.safePath(); const file = join(this.folder, "quota.json");
    if (!existsSync(file)) return { version: "quota-0.3", entries: [] };
    try {
      const data = schema.parse(JSON.parse(readFileSync(file, "utf8")));
      if (new Set(data.entries.map(e => e.id)).size !== data.entries.length || data.entries.some(e => e.at > this.clock())) throw new Error();
      return data;
    } catch { throw new Error("QUOTA_LEDGER_INVALID"); }
  }
  private transaction<T>(change: (state: State) => T): T {
    this.safePath(); mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const lock = join(this.folder, "quota.lock"); let fd: number;
    try { fd = openSync(lock, "wx", 0o600); } catch { throw new Error("QUOTA_LOCKED"); }
    try {
      const state = this.read(), result = change(state), temp = join(this.folder, `quota-${randomUUID()}.tmp`);
      const output = openSync(temp, "wx", 0o600);
      try { writeFileSync(output, JSON.stringify(state)); fsyncSync(output); } finally { closeSync(output); }
      renameSync(temp, join(this.folder, "quota.json"));
      if (process.platform !== "win32") { const directory = openSync(this.folder, "r"); try { fsyncSync(directory); } finally { closeSync(directory); } }
      return result;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  reserve(tokens: number): string {
    if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > QUOTA.tpm) throw new Error("QUOTA_REQUEST_BOUND");
    return this.transaction(state => {
      const now = this.clock(), day = new Date(now).toISOString().slice(0, 10);
      const today = state.entries.filter(e => new Date(e.at).toISOString().slice(0, 10) === day), minute = state.entries.filter(e => now - e.at < 60000);
      if (state.entries.some(e => e.state === "RESERVED")) throw new Error("QUOTA_IN_FLIGHT");
      if (state.entries.some(e => e.usage && e.usage.inputTokens + e.usage.outputTokens > e.tokens)) throw new Error("QUOTA_BOUND_VIOLATION");
      if (state.entries.length >= QUOTA.attempts) throw new Error("QUOTA_EXPERIMENT");
      if (today.length >= QUOTA.rpd) throw new Error("QUOTA_RPD");
      if (minute.length >= QUOTA.rpm) throw new Error("QUOTA_RPM");
      if (minute.reduce((s, e) => s + e.tokens, 0) + tokens > QUOTA.tpm) throw new Error("QUOTA_TPM");
      if (today.reduce((s, e) => s + e.tokens, 0) + tokens > QUOTA.tpd) throw new Error("QUOTA_TPD");
      const id = randomUUID(); state.entries.push({ id, at: now, tokens, state: "RESERVED", usage: null }); return id;
    });
  }
  finish(id: string, state: "COMPLETED" | "FAILED" | "UNKNOWN", usage: z.infer<typeof entry>["usage"] = null) {
    this.transaction(data => {
      const found = data.entries.find(e => e.id === id); if (!found || found.state !== "RESERVED") throw new Error("QUOTA_RESERVATION_STATE");
      found.state = state; found.usage = usage; schema.parse(data);
    });
  }
  summary() {
    const s = this.read(), day = new Date(this.clock()).toISOString().slice(0, 10);
    return { limits: QUOTA, attempts: s.entries.length, inFlight: s.entries.some(e => e.state === "RESERVED"),
      reservedTokensToday: s.entries.filter(e => new Date(e.at).toISOString().slice(0, 10) === day).reduce((n, e) => n + e.tokens, 0),
      actualInputTokens: s.entries.reduce((n, e) => n + (e.usage?.inputTokens ?? 0), 0), actualOutputTokens: s.entries.reduce((n, e) => n + (e.usage?.outputTokens ?? 0), 0) };
  }
}
