import { NextResponse } from "next/server";

import { settingsStore } from "@/lib/metaflow-server";

export async function GET() {
  const settings = await settingsStore.load();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { settings?: unknown } | null;
  if (!body?.settings || typeof body.settings !== "object") {
    return NextResponse.json({ error: "Settings are required." }, { status: 400 });
  }

  const settings = await settingsStore.save(body.settings);
  return NextResponse.json({ settings });
}
