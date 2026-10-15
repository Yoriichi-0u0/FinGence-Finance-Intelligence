import "server-only";
import { Pool, types, type PoolConfig } from "pg";
import { PersistenceError } from "../persistence/contracts";

export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}
export interface SqlConnection {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
}
export interface CheckedOutConnection extends SqlConnection {
  release(destroy?: boolean): void;
}
export interface ConnectionPool {
  connect(): Promise<CheckedOutConnection>;
  end(): Promise<void>;
}
export interface TransactionDatabase {
  transaction<T>(work: (connection: SqlConnection) => Promise<T>, options?: TransactionOptions): Promise<T>;
  close(): Promise<void>;
}
export interface TransactionOptions {
  isolationLevel: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
}
export const DATABASE_LIMITS = {
  poolSize: 4, connectionMs: 5_000, idleMs: 10_000,
  statementMs: 10_000, lockMs: 3_000, idleTransactionMs: 10_000, transactionMs: 30_000,
} as const;

/** Never return the configuration through the service or print it. */
export function serverPoolConfig(environment: Readonly<Record<string, string | undefined>> = process.env): PoolConfig {
  try {
    const value = environment.SUPABASE_DATABASE_URL;
    if (!value) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username
      || url.pathname.length <= 1 || url.hash) throw new Error();
    for (const key of url.searchParams.keys()) if (key !== "sslmode") throw new Error();
    if (url.searchParams.getAll("sslmode").length > 1) throw new Error();
    const mode = url.searchParams.get("sslmode");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (mode && !["require", "verify-full", ...(local ? ["disable"] : [])].includes(mode)) throw new Error();
    const tls = mode !== "disable" && (!local || mode !== null);
    const ca = environment.SUPABASE_DATABASE_CA_CERT;
    if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port ? Number(url.port) : 5432,
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      // Parse URL fields ourselves: sslmode cannot override certificate verification.
      ssl: tls ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
      max: DATABASE_LIMITS.poolSize, connectionTimeoutMillis: DATABASE_LIMITS.connectionMs,
      idleTimeoutMillis: DATABASE_LIMITS.idleMs, statement_timeout: DATABASE_LIMITS.statementMs,
      lock_timeout: DATABASE_LIMITS.lockMs, idle_in_transaction_session_timeout: DATABASE_LIMITS.idleTransactionMs,
      query_timeout: DATABASE_LIMITS.statementMs + 1_000,
      application_name: "finsight-internal-persistence",
      // Per-pool parsers, never mutate pg's global NUMERIC/date parser registry.
      types: { getTypeParser: (oid, format) => [1700, 1082, 1114, 1184].includes(oid)
        ? (input: string) => input : types.getTypeParser(oid, format) },
    };
  } catch {
    throw new PersistenceError("DATABASE_CONFIGURATION");
  }
}

function sqlState(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
}

/** One checked-out connection, no automatic retries, including uncertain commits. */
export function transactionDatabase(pool: ConnectionPool): TransactionDatabase {
  return {
    async transaction<T>(work: (connection: SqlConnection) => Promise<T>, options?: TransactionOptions): Promise<T> {
      const begins = {
        "READ COMMITTED": "BEGIN ISOLATION LEVEL READ COMMITTED",
        "REPEATABLE READ": "BEGIN ISOLATION LEVEL REPEATABLE READ",
        "SERIALIZABLE": "BEGIN ISOLATION LEVEL SERIALIZABLE",
      } as const;
      const begin = options ? begins[options.isolationLevel] : "BEGIN";
      if (!begin) throw new PersistenceError("INVALID_INPUT");
      let client: CheckedOutConnection;
      try { client = await pool.connect(); } catch { throw new PersistenceError("DATABASE_UNAVAILABLE"); }
      let began = false, committing = false, destroy = false;
      const deadline = Date.now() + DATABASE_LIMITS.transactionMs;
      const connection: SqlConnection = {
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          if (Date.now() >= deadline) throw new PersistenceError("PERSISTENCE_FAILED");
          return client.query<Row>(sql, values);
        },
      };
      try {
        await client.query(begin);
        began = true;
        await connection.query("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)",
          [String(DATABASE_LIMITS.statementMs), String(DATABASE_LIMITS.lockMs), String(DATABASE_LIMITS.idleTransactionMs)]);
        const result = await work(connection);
        if (Date.now() >= deadline) throw new PersistenceError("PERSISTENCE_FAILED");
        committing = true;
        await client.query("COMMIT");
        began = false;
        return result;
      } catch (error) {
        const code = sqlState(error);
        // A server-reported integrity/transaction rollback failure is definitive.
        const uncertainCommit = committing && !(code?.startsWith("23") || code?.startsWith("40"));
        destroy = !code || code.startsWith("08") || uncertainCommit;
        let rollbackFailed = false;
        if (began) {
          try { await client.query("ROLLBACK"); } catch { rollbackFailed = true; destroy = true; }
        } else destroy = true;
        if (uncertainCommit) throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN");
        if (rollbackFailed) throw new PersistenceError("ROLLBACK_UNCONFIRMED");
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError("PERSISTENCE_FAILED");
      } finally {
        // Destroy uncertain/broken connections rather than returning them to the pool.
        try { client.release(destroy); } catch {
          // Cleanup cannot undo an acknowledged COMMIT or replace an uncertain
          // transaction outcome. Preserve the receipt/classified error; never retry.
        }
      }
    },
    async close() {
      try { await pool.end(); } catch { throw new PersistenceError("DATABASE_UNAVAILABLE"); }
    },
  };
}

export function createPostgresDatabase(environment: Readonly<Record<string, string | undefined>> = process.env): TransactionDatabase {
  const configuration = serverPoolConfig(environment);
  let pool: Pool;
  try {
    pool = new Pool(configuration);
    // pg idle connection errors must have a listener. No raw errors are logged.
    pool.on("error", () => {});
  } catch { throw new PersistenceError("DATABASE_CONFIGURATION"); }
  return transactionDatabase(pool);
}
