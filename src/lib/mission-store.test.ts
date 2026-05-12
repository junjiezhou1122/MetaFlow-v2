import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { FileMissionStore, appendMissionEvent } from "./mission-store";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "metaflow-missions-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mission store", () => {
  it("creates a running mission and persists status updates", async () => {
    const dataDir = await createTempDir();
    const store = new FileMissionStore(dataDir);

    const mission = await store.create("生成一个 todolist web 应用");
    await store.update(mission.id, {
      stage: "reviewing",
      status: "running",
      preview: {
        mission: mission.input,
        selectedCapabilities: [],
        ephemeralAgents: [],
        tasks: [],
        events: [],
        finalBrief: "Reviewer is checking the artifact.",
      },
    });

    const reloaded = new FileMissionStore(dataDir);
    const storedMission = await reloaded.get(mission.id);

    expect(storedMission).toMatchObject({
      id: mission.id,
      title: "生成一个 todolist web 应用",
      input: "生成一个 todolist web 应用",
      status: "running",
      stage: "reviewing",
    });
    expect(storedMission?.preview?.finalBrief).toBe("Reviewer is checking the artifact.");
  });

  it("persists stalled missions", async () => {
    const store = new FileMissionStore(await mkdtemp(join(tmpdir(), "metaflow-store-")));
    const mission = await store.create("Build a long running deck");

    await store.update(mission.id, {
      status: "stalled",
      stage: "stalled",
      error: "No progress has been observed for a while.",
    });

    const stored = await store.get(mission.id);
    expect(stored?.status).toBe("stalled");
    expect(stored?.stage).toBe("stalled");
  });

  it("appends follow-up prompt events immediately before async execution", async () => {
    const store = new FileMissionStore(await createTempDir());
    const mission = await store.create("Build a scoreboard app");
    const preview = {
      mission: mission.input,
      selectedCapabilities: [],
      ephemeralAgents: [],
      tasks: [],
      events: [],
      finalBrief: "Initial mission is ready.",
    };
    await store.update(mission.id, {
      status: "ready",
      stage: "done",
      preview,
    });

    const updated = await store.update(mission.id, {
      status: "running",
      stage: "queued",
      error: undefined,
      preview: appendMissionEvent(
        preview,
        "task.started",
        "User added a follow-up prompt: make it lighter",
      ),
    });

    expect(updated?.preview?.events).toEqual([
      {
        id: "event-1",
        type: "task.started",
        message: "User added a follow-up prompt: make it lighter",
      },
    ]);
  });

  it("ignores stale async updates from older mission runs", async () => {
    const store = new FileMissionStore(await createTempDir());
    const mission = await store.create("Build an Anki app");

    await store.update(mission.id, {
      status: "running",
      stage: "building",
      activeRunId: "run-new",
      preview: {
        mission: mission.input,
        selectedCapabilities: [],
        ephemeralAgents: [],
        tasks: [],
        events: [],
        artifacts: [
          {
            id: "artifact-1",
            type: "html",
            filename: "index.html",
            title: "index.html",
            content: "<!doctype html><html></html>",
            description: "Generated app",
          },
        ],
        finalBrief: "New run has the latest artifact.",
      },
    });

    const stale = await store.updateIfRunActive(mission.id, "run-old", {
      status: "running",
      stage: "building",
      preview: {
        mission: mission.input,
        selectedCapabilities: [],
        ephemeralAgents: [],
        tasks: [],
        events: [],
        artifacts: [],
        finalBrief: "Old run is still building.",
      },
    });
    const stored = await store.get(mission.id);

    expect(stale).toBeNull();
    expect(stored?.activeRunId).toBe("run-new");
    expect(stored?.preview?.artifacts).toHaveLength(1);
    expect(stored?.preview?.finalBrief).toBe("New run has the latest artifact.");
  });

  it("lists newest meaningful missions first", async () => {
    const store = new FileMissionStore(await createTempDir());

    const first = await store.create("First mission");
    const second = await store.create("Second mission");
    await store.update(second.id, { status: "ready", stage: "done" });

    const missions = await store.list();

    expect(missions[0]?.id).toBe(second.id);
    expect(missions[1]?.id).toBe(first.id);
  });

  it("marks old missions with only orchestration artifacts as failed", async () => {
    const dataDir = await createTempDir();
    await writeFile(
      join(dataDir, "missions.json"),
      JSON.stringify([
        {
          id: "bad",
          title: "生成一个 todolist web 应用",
          input: "生成一个 todolist web 应用",
          status: "ready",
          stage: "done",
          createdAt: "2026-05-10T10:00:00.000Z",
          updatedAt: "2026-05-10T10:00:00.000Z",
          preview: {
            mission: "生成一个 todolist web 应用",
            selectedCapabilities: [],
            ephemeralAgents: [],
            tasks: [],
            events: [],
            finalBrief: "Reviewer requested repair; Builder completed one repair pass.",
            artifacts: [
              {
                id: "artifact-1",
                type: "text",
                filename: "review.json",
                title: "review.json",
                content: "{}",
                description: "Internal review metadata.",
              },
            ],
          },
        },
      ]),
      "utf8",
    );

    const store = new FileMissionStore(dataDir);
    const [mission] = await store.list();

    expect(mission?.status).toBe("failed");
    expect(mission?.stage).toBe("failed");
    expect(mission?.preview?.artifacts).toEqual([]);
    expect(mission?.error).toContain("internal orchestration");
  });
});
