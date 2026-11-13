import "server-only";

export function financialExplanationLocalEnabled(): boolean {
  return process.env.NODE_ENV === "development"
    && process.env.FINGENCE_AI_EXPLANATION_LOCAL === "1"
    && !process.env.VERCEL;
}

/** Local-development isolation only; this is not production authentication. */
export function financialExplanationRequestAllowed(request: Request): boolean {
  if (!financialExplanationLocalEnabled()) return false;
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  let browserOrigin: URL;
  try {
    browserOrigin = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`);
  } catch {
    return false;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(browserOrigin.hostname)
    || browserOrigin.port !== url.port) return false;
  const origin = request.headers.get("origin");
  return (!origin || origin === browserOrigin.origin)
    && request.headers.get("sec-fetch-site") !== "cross-site";
}
