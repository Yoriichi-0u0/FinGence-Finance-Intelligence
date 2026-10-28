import { describe, expect, it, vi } from "vitest";
import { beginOperation, pendingOperationKey, submitOperation } from "../../lib/ai-ingestion/v2-i1-client";
function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: k => values.get(k) ?? null,
    key: i => [...values.keys()][i] ?? null, removeItem: k => { values.delete(k); }, setItem: (k,v) => { values.set(k,v); } };
}
const id = "d163d7f2-3fd2-4f9b-b26b-7a2e79e61590";
describe("browser operation marker", () => {
  it("records the ID before dispatch and a new page sees the same pending operation", () => {
    const saved = storage(); expect(beginOperation(saved, () => id)).toBe(id);
    expect(saved.getItem(pendingOperationKey)).toBe(id);
    expect(() => beginOperation(saved, () => "another")).toThrow("OPERATION_PENDING");
  });
  it.each(["network rejection", "invalid JSON"])("retains the original ID after %s", async scenario => {
    const saved = storage(); beginOperation(saved, () => id);
    const fetcher = scenario === "network rejection" ? vi.fn().mockRejectedValue(new Error("network")) : vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    await expect(submitOperation(fetcher, id, "synthetic", new FormData())).rejects.toThrow();
    expect(saved.getItem(pendingOperationKey)).toBe(id); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() => beginOperation(saved, () => "new")).toThrow("OPERATION_PENDING");
  });
  it("returns a valid matching result without retries", async () => {
    const response = { batch: { attemptId: id, processing: {} }, stages: [] };
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    expect(await submitOperation(fetcher, id, "synthetic", new FormData())).toEqual(response);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
