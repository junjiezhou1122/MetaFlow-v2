import { NextResponse } from "next/server";

import { installMarketAgent } from "@/lib/agent-market";
import { agentRegistry } from "@/lib/metaflow-server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { marketId?: unknown } | null;
  const marketId = typeof body?.marketId === "string" ? body.marketId : "";
  const agent = installMarketAgent(marketId);

  if (!agent) {
    return NextResponse.json({ error: "Market agent not found." }, { status: 404 });
  }

  const saved = await agentRegistry.upsert(agent);
  return NextResponse.json({ agent: saved }, { status: 201 });
}
