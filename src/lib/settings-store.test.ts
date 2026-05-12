import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { FileSettingsStore } from "./settings-store";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "metaflow-settings-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("settings store", () => {
  it("persists provider settings on the server", async () => {
    const dataDir = await createTempDir();
    const store = new FileSettingsStore(dataDir);

    await store.save({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "http://181.215.5.243:3009/v1",
      model: "gpt-5.4",
    });

    const reloaded = new FileSettingsStore(dataDir);
    await expect(reloaded.load()).resolves.toEqual({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "http://181.215.5.243:3009/v1",
      model: "gpt-5.4",
    });
  });
});
