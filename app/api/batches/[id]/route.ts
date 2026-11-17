import { localTransactionReads, transactionApiHeaders, transactionApiResponse } from "@/lib/server/integration/local-transaction-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const service = localTransactionReads(request);
    const result = await service.reads.getBatch(id, request);
    return Response.json(result, { headers: transactionApiHeaders });
  } catch (error) {
    return transactionApiResponse(error);
  }
}
