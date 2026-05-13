import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  FileMemoryStore,
  createMemoryBackend,
  createMetaAgentMemoryFiles,
  writeMissionMemorySummary,
} from "./memory-store";

describe("memory store", () => {
  it("persists scoped markdown memories on disk", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "metaflow-memory-"));
    const store = new FileMemoryStore(dataDir);

    await store.write("users/default/preferences.md", "Prefers compact task boards.");
    await store.write("agents/meta-agent/lessons.md", "Use feature-level todos.");

    await expect(store.read("users/default/preferences.md")).resolves.toBe(
      "Prefers compact task boards.",
    );
    await expect(
      readFile(join(dataDir, "memories/users/default/preferences.md"), "utf8"),
    ).resolves.toBe("Prefers compact task boards.");
    await expect(store.list("agents/meta-agent")).resolves.toEqual([
      "agents/meta-agent/lessons.md",
    ]);
  });

  it("exposes /memories files through a DeepAgents backend", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "metaflow-memory-backend-"));
    const store = new FileMemoryStore(dataDir);
    await store.write("users/default/preferences.md", "Use Chinese UI copy.");
    const backend = createMemoryBackend(store);

    await expect(backend.read("/preferences.md")).resolves.toMatchObject({
      content: "Use Chinese UI copy.",
      mimeType: "text/markdown",
    });
    await expect(backend.write("/agents/meta-agent/lessons.md", "Plan sections first.")).resolves.toMatchObject({
      path: "/agents/meta-agent/lessons.md",
      filesUpdate: null,
    });
    await expect(store.read("agents/meta-agent/lessons.md")).resolves.toBe(
      "Plan sections first.",
    );
  });

  it("builds default meta-agent memory files before runtime starts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "metaflow-memory-defaults-"));
    const store = new FileMemoryStore(dataDir);

    const files = await createMetaAgentMemoryFiles(store);

    expect(files).toEqual([
      "/memories/preferences.md",
      "/memories/meta-agent-lessons.md",
    ]);
    await expect(store.read("users/default/preferences.md")).resolves.toContain(
      "User preferences",
    );
    await expect(store.read("agents/meta-agent/lessons.md")).resolves.toContain(
      "Meta Agent lessons",
    );
  });

  it("writes mission summaries into durable memory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "metaflow-memory-summary-"));
    const store = new FileMemoryStore(dataDir);

    await writeMissionMemorySummary(
      {
        id: "mission-123",
        title: "Build voting app",
        input: "Build a voting app with results.",
        status: "ready",
        stage: "done",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:05:00.000Z",
        preview: {
          mission: "Build a voting app with results.",
          selectedCapabilities: [],
          ephemeralAgents: [],
          tasks: [
            {
              id: "task-vote",
              section: "Voting",
              feature: "Cast vote",
              title: "Cast vote",
              description: "Let a user vote for one option.",
              assignedTo: "Builder",
              status: "done",
              expectedArtifact: "index.html",
            },
          ],
          events: [],
          finalBrief: "Voting app is ready.",
          artifacts: [
            {
              id: "artifact-1",
              type: "html",
              filename: "index.html",
              title: "Voting app",
              content: "<!doctype html>",
              description: "Runnable app.",
            },
          ],
        },
      },
      store,
    );

    await expect(store.read("missions/mission-123/summary.md")).resolves.toContain(
      "Voting / Cast vote",
    );
    await expect(store.read("missions/mission-123/summary.md")).resolves.toContain(
      "index.html",
    );
  });
});
