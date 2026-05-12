import { NextResponse } from "next/server";

import { agentRegistry } from "@/lib/metaflow-server";

export async function GET() {
  const agents = await agentRegistry.list();
  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Agent profile is required." }, { status: 400 });
  }

  const saved = await agentRegistry.upsert(body as never);
  return NextResponse.json({ agent: saved }, { status: 201 });
}
