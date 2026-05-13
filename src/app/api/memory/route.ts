import { NextResponse } from "next/server";

import { FileMemoryStore, listMemoryFiles } from "@/lib/memory-store";

const editableMemoryPaths = new Set([
  "users/default/preferences.md",
  "agents/meta-agent/lessons.md",
]);

export async function GET() {
  const memories = await listMemoryFiles();
  return NextResponse.json({ memories });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    content?: unknown;
  } | null;
  const path = typeof body?.path === "string" ? body.path.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";

  if (!path) {
    return NextResponse.json({ error: "Memory path is required." }, { status: 400 });
  }
  if (!editableMemoryPaths.has(path)) {
    return NextResponse.json(
      { error: "Only shared preference and meta-agent lesson memories can be edited here." },
      { status: 403 },
    );
  }

  const store = new FileMemoryStore();
  await store.write(path, content);
  return NextResponse.json({ memory: { path, content } });
}
