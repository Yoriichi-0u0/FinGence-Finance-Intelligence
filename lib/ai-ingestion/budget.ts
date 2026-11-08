import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const entrySchema = z.strictObject({ id: z.string(), state: z.enum(["RESERVED", "SETTLED"]), inputTokens: z.number().int().min(0).max(32000), outputTokens: z.number().int().min(0).max(6000), requestId: z.string().nullable() });
const ledgerSchema = z.strictObject({ version: z.literal(1), entries: z.array(entrySchema).max(33) });
/** Integer microdollars; never refunds reservations, even after crashes or timeouts. */
export class BudgetLedger {
  constructor(private directory: string) {}
  private access<T>(operation: (data: z.infer<typeof ledgerSchema>) => T, mutate = false): T {
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink()) throw new Error("Unsafe ledger directory.");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, "budget.lock"); let fd: number;
    try { fd = openSync(lock, "wx", 0o600); } catch { throw new Error("Budget ledger is locked. Resolve a previous attempt before retrying."); }
    try {
      const path = join(this.directory, "budget.json");
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Unsafe budget ledger.");
      const data = existsSync(path) ? ledgerSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : { version: 1 as const, entries: [] };
      const output = operation(data);
      if (mutate) {
        const temporary = join(this.directory, `budget-${randomUUID()}.tmp`);
        writeFileSync(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 }); renameSync(temporary, path);
      }
      return output;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  reserve(): string {
    return this.access(data => {
      if ((data.entries.length + 1) * 150000 > 5000000) throw new Error("US$5 experimental budget would be exceeded.");
      const id = randomUUID(); data.entries.push({ id, state: "RESERVED", inputTokens: 0, outputTokens: 0, requestId: null }); return id;
    }, true);
  }
  settle(id: string, usage: { inputTokens: number; outputTokens: number; requestId: string }) {
    this.access(data => {
      const entry = data.entries.find(e => e.id === id);
      if (!entry || entry.state !== "RESERVED") throw new Error("Unknown or already settled reservation.");
      const next = entrySchema.parse({ ...entry, ...usage, state: "SETTLED" }); Object.assign(entry, next);
    }, true);
  }
  summary() {
    return this.access(data => ({ limitMicroUsd: 5000000, reservedMicroUsd: data.entries.length * 150000,
      estimatedMicroUsd: data.entries.reduce((sum, e) => sum + e.inputTokens * 2 + e.outputTokens * 10, 0),
      calls: data.entries.length, pending: data.entries.filter(e => e.state === "RESERVED").length }));
  }
}
