/** Browser-only recovery marker. This is a correlation identifier, never authorization. */
export const pendingOperationKey = "fingence-v2-i1-pending-operation";
export function beginOperation(storage: Storage, randomId: () => string): string {
  if (storage.getItem(pendingOperationKey)) throw new Error("OPERATION_PENDING");
  const id = randomId();
  storage.setItem(pendingOperationKey, id);
  if (storage.getItem(pendingOperationKey) !== id) throw new Error("STORAGE_UNAVAILABLE");
  return id;
}
export async function submitOperation(fetcher: typeof fetch, id: string, token: string, form: FormData) {
  const response = await fetcher("/api/ai-ingestion/v2-i1", { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-FinGence-Operation": id }, body: form });
  const data = await response.json();
  if (!response.ok || data?.batch?.attemptId !== id || !data.batch?.processing || !Array.isArray(data.stages)) throw new Error("RESPONSE_UNCONFIRMED");
  return data;
}
