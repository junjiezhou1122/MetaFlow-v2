import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileAgentRegistry,
  createDefaultAgentProfiles,
} from "./agent-registry";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "metaflow-agents-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent registry", () => {
  it("starts with planner, builder, and reviewer profiles", async () => {
    const registry = new FileAgentRegistry(await createTempDir());

    const agents = await registry.list();

    expect(agents.map((agent) => agent.id)).toEqual(
      expect.arrayContaining(["planner", "builder", "reviewer"]),
    );
    expect(agents.find((agent) => agent.id === "builder")?.skills).toContain("artifact generation");
  });

  it("persists added and edited agent profiles", async () => {
    const dataDir = await createTempDir();
    const registry = new FileAgentRegistry(dataDir);

    await registry.upsert({
      id: "designer",
      name: "Designer",
      description: "Shapes simple user-facing UI.",
      skills: ["interface design", "layout"],
      taskScope: "Improve mission artifacts with a cleaner user experience.",
      successCriteria: ["Keep the UI simple.", "Avoid noisy controls."],
      temporary: false,
      createdBy: "system",
    });
    await registry.upsert({
      ...(await registry.get("designer"))!,
      skills: ["interface design", "layout", "visual review"],
    });

    const reloaded = new FileAgentRegistry(dataDir);
    const designer = await reloaded.get("designer");

    expect(designer?.skills).toContain("visual review");
    expect((await reloaded.list()).length).toBe(createDefaultAgentProfiles().length + 1);
  });
});
