import { NextResponse } from "next/server";

import { appLibrary, missionStore } from "@/lib/metaflow-server";

export async function GET() {
  const apps = await appLibrary.list();
  return NextResponse.json({ apps });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    missionId?: unknown;
    title?: unknown;
  } | null;
  const missionId = typeof body?.missionId === "string" ? body.missionId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!missionId) {
    return NextResponse.json({ error: "Mission is required." }, { status: 400 });
  }

  const mission = await missionStore.get(missionId);
  const artifacts = mission?.preview?.artifacts ?? [];
  if (!mission || artifacts.length === 0) {
    return NextResponse.json(
      { error: "Mission has no app artifact to save." },
      { status: 400 },
    );
  }

  const app = await appLibrary.save({
    title: title || mission.title,
    sourceMissionId: mission.id,
    sourceMissionInput: mission.input,
    artifacts,
  });

  return NextResponse.json({ app }, { status: 201 });
}
