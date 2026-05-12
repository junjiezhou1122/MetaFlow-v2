import { NextResponse } from "next/server";

import { appLibrary } from "@/lib/metaflow-server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const app = await appLibrary.get(id);

  if (!app) {
    return NextResponse.json({ error: "App not found." }, { status: 404 });
  }

  return NextResponse.json({ app });
}
