import { NextResponse } from "next/server";

import { listMarketAgents } from "@/lib/agent-market";

export async function GET() {
  return NextResponse.json({ agents: listMarketAgents() });
}
