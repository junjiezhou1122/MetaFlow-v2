import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createSkillLibraryAgent, loadWorkspaceSkills } from "./skill-registry";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "metaflow-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill registry", () => {
  it("loads real SKILL.md files from workspace skill sources", async () => {
    const dir = await createTempDir();
    const skillDir = join(dir, ".agents", "skills", "deck-writer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: deck-writer",
        "description: Create presentation decks from structured outlines.",
        "---",
        "# Deck Writer",
        "",
        "Build a clear slide narrative.",
      ].join("\n"),
      "utf8",
    );

    const skills = await loadWorkspaceSkills(dir);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "deck-writer",
      name: "deck-writer",
      description: "Create presentation decks from structured outlines.",
    });
    expect(skills[0]?.markdown).toContain("Build a clear slide narrative");
  });

  it("creates a library agent for discovered external skills", async () => {
    const agent = createSkillLibraryAgent([
      {
        id: "deck-writer",
        name: "deck-writer",
        description: "Create presentation decks.",
        markdown: "# Deck Writer",
        source: "user",
        trustLevel: "markdown_only",
      },
    ]);

    expect(agent).toMatchObject({
      id: "skill-library",
      name: "Skill Library",
      skillIds: ["deck-writer"],
    });
    expect(agent?.skillDetails?.[0]?.markdown).toContain("Deck Writer");
  });

  it("filters workspace skills to the mission query", async () => {
    const dir = await createTempDir();
    const deckDir = join(dir, ".agents", "skills", "deck-writer");
    const videoDir = join(dir, ".agents", "skills", "video-maker");
    await mkdir(deckDir, { recursive: true });
    await mkdir(videoDir, { recursive: true });
    await writeFile(
      join(deckDir, "SKILL.md"),
      "---\nname: deck-writer\ndescription: Create presentation slide decks.\n---\n# Deck",
      "utf8",
    );
    await writeFile(
      join(videoDir, "SKILL.md"),
      "---\nname: video-maker\ndescription: Create video animations.\n---\n# Video",
      "utf8",
    );

    const skills = await loadWorkspaceSkills(dir, "make a presentation deck");

    expect(skills.map((skill) => skill.id)).toEqual(["deck-writer"]);
  });
});
