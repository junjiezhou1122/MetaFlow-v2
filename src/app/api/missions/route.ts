import { NextResponse } from "next/server";

import { missionStore, startMissionExecution } from "@/lib/metaflow-server";

export async function GET() {
  const missions = await missionStore.list();
  return NextResponse.json({ missions });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    mission?: unknown;
    settings?: unknown;
  } | null;
  const mission = typeof body?.mission === "string" ? body.mission.trim() : "";

  if (!mission) {
    return NextResponse.json({ error: "Mission is required." }, { status: 400 });
  }

  const storedMission = await missionStore.create(mission);
  await startMissionExecution(storedMission, body?.settings);

  return NextResponse.json({ mission: storedMission }, { status: 202 });
}
