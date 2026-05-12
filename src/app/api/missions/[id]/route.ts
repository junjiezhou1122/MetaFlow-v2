import { NextResponse } from "next/server";

import { missionStore, startMissionIteration } from "@/lib/metaflow-server";
import { appendMissionEvent } from "@/lib/mission-store";
import { buildMissionPreview } from "@/lib/mission-runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const mission = await missionStore.get(id);

  if (!mission) {
    return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  }

  return NextResponse.json({ mission });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
    settings?: unknown;
  } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const mission = await missionStore.get(id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  }

  if (mission.status === "running") {
    return NextResponse.json(
      { error: "Mission is already running." },
      { status: 409 },
    );
  }

  const basePreview = mission.preview ?? buildMissionPreview(mission.input);
  const updatedMission = await missionStore.update(id, {
    status: "running",
    stage: "queued",
    error: undefined,
    preview: appendMissionEvent(
      basePreview,
      "task.started",
      `User added a follow-up prompt: ${prompt}`,
    ),
  });
  await startMissionIteration(updatedMission ?? mission, prompt, body?.settings);

  return NextResponse.json({ mission: updatedMission ?? mission }, { status: 202 });
}
