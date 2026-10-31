import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { pocLocalEnabled, pocRequestAllowed } from "../lib/server/poc-reconciliation/runtime";
import LocalPocOverview from "../components/poc-overview";
import IllustrativeOverview from "./illustrative";

export default async function OverviewPage() {
  if (!pocLocalEnabled()) return <IllustrativeOverview />;

  const incoming = await headers();
  let request: Request;
  try { request = new Request(`http://${incoming.get("host") ?? "invalid"}/`, { headers: incoming }); }
  catch { notFound(); }
  if (!pocRequestAllowed(request)) notFound();
  return <LocalPocOverview />;
}
