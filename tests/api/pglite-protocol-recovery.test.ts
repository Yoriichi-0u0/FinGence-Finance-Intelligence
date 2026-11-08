import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// The PostgreSQL extended-query protocol ends a batch with one Sync message.
function message(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  const length = Buffer.alloc(4);
  length.writeInt32BE(payload.length + 4);
  return Buffer.concat([Buffer.from(type), length, payload]);
}

function int16(value: number): Buffer {
  const result = Buffer.alloc(2);
  result.writeInt16BE(value);
  return result;
}

function int32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeInt32BE(value);
  return result;
}

function extendedQuery(sql: string, parameter: string): Buffer {
  const value = Buffer.from(parameter);
  return Buffer.concat([
    message("P", Buffer.from("\0"), Buffer.from(`${sql}\0`), int16(0)),
    message("B", Buffer.from("\0\0"), int16(0), int16(1), int32(value.length), value, int16(0)),
    message("E", Buffer.from("\0"), int32(0)),
    message("S"),
  ]);
}

function frames(bytes: Uint8Array): { type: string; payload: Buffer }[] {
  const data = Buffer.from(bytes);
  const result: { type: string; payload: Buffer }[] = [];
  let offset = 0;
  while (offset < data.length) {
    if (offset + 5 > data.length) throw new Error("Truncated protocol header");
    const length = data.readInt32BE(offset + 1);
    if (length < 4 || offset + 1 + length > data.length) throw new Error("Invalid protocol frame");
    result.push({ type: data.toString("ascii", offset, offset + 1), payload: data.subarray(offset + 5, offset + 1 + length) });
    offset += 1 + length;
  }
  return result;
}

describe("disposable PGlite extended-protocol recovery", () => {
  it("emits exactly one ReadyForQuery per successful Sync", async () => {
    const db = await PGlite.create();
    try {
      const response = frames(await db.execProtocolRaw(extendedQuery("SELECT $1::int", "1")));
      expect(response.filter(frame => frame.type === "E")).toHaveLength(0);
      expect(response.filter(frame => frame.type === "Z").map(frame => frame.payload.toString("ascii"))).toEqual(["I"]);
    } finally {
      await db.close();
    }
  });

  it("emits one ReadyForQuery after a constraint error and recovers after rollback", async () => {
    const db = await PGlite.create();
    try {
      await db.exec("CREATE TABLE protocol_fixture (id integer PRIMARY KEY, status text CHECK (status IN ('VALID', 'WARNING')))");
      await db.exec("INSERT INTO protocol_fixture VALUES (1, 'VALID')");
      await db.exec("BEGIN");
      const response = frames(await db.execProtocolRaw(extendedQuery(
        "UPDATE protocol_fixture SET status = 'REJECTED' WHERE id = $1::int", "1",
      )));
      const errors = response.filter(frame => frame.type === "E");
      expect(errors).toHaveLength(1);
      expect(errors[0].payload.includes(Buffer.from("C23514\0"))).toBe(true);
      expect(response.filter(frame => frame.type === "Z").map(frame => frame.payload.toString("ascii"))).toEqual(["E"]);
      await db.exec("ROLLBACK");
      expect((await db.query("SELECT id, status FROM protocol_fixture WHERE id = $1", [1])).rows).toEqual([{ id: 1, status: "VALID" }]);
    } finally {
      await db.close();
    }
  });
});
