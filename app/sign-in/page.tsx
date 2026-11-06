import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspaceEnabled } from "@/lib/server/workspace/store";
import { SignIn } from "@/components/workspace/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/** Hosted workspace only: absent (404) unless FINGENCE_WORKSPACE=1 and the store is configured. */
export default function Page() {
  if (!workspaceEnabled()) notFound();
  return <SignIn />;
}
