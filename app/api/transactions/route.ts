import { localTransactionReads, transactionApiHeaders, transactionApiResponse } from "@/lib/server/integration/local-transaction-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const service = localTransactionReads(request);
    const result = await service.reads.listTransactions(new URL(request.url).searchParams, request);
    return Response.json(result, { headers: transactionApiHeaders });
  } catch (error) {
    return transactionApiResponse(error);
  }
}
