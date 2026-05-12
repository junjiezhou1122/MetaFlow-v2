import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";

import type { AgentProfile, AgentSkill } from "./mission-runtime";

type SkillSource = {
  label: string;
  dir: string;
};

export async function loadWorkspaceSkills(
  workspaceDir = process.cwd(),
  query = "",
): Promise<AgentSkill[]> {
  const sources: SkillSource[] = [
    {
      label: ".agents/skills",
      dir: join(/*turbopackIgnore: true*/ workspaceDir, ".agents", "skills"),
    },
    {
      label: "skills",
      dir: join(/*turbopackIgnore: true*/ workspaceDir, "skills"),
    },
  ];
  const loaded = await Promise.all(
    sources.map((source) => loadSkillsFromSource(source)),
  );

  return selectRelevantSkills(dedupeSkills(loaded.flat()), query);
}

export function createSkillLibraryAgent(skills: AgentSkill[]): AgentProfile | null {
  if (skills.length === 0) {
    return null;
  }

  return {
    id: "skill-library",
    name: "Skill Library",
    description: "External workspace skills discovered from local skill catalogs.",
    skills: skills.map((skill) => skill.name),
    skillIds: skills.map((skill) => skill.id),
    skillDetails: skills,
    instructions:
      "Expose discovered workspace skills to Meta Agent and DeepAgents. Use these skills only after reading the relevant SKILL.md.",
    taskScope: "Provide reusable external skill documents for mission planning and execution.",
    successCriteria: [
      "External skill documents are discoverable by DeepAgents.",
      "Meta Agent can match mission needs to imported skills.",
    ],
    temporary: false,
    createdBy: "system",
    source: "system",
    category: "skills",
    tags: ["skills", "external", "workspace"],
  };
}

async function loadSkillsFromSource(source: SkillSource): Promise<AgentSkill[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(source.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const skillPath = join(source.dir, entry.name, "SKILL.md");
        try {
          const markdown = await readFile(skillPath, "utf8");
          return parseSkillMarkdown(markdown, entry.name, source.label);
        } catch {
          return null;
        }
      }),
  );

  return skills.filter((skill): skill is AgentSkill => Boolean(skill));
}

function parseSkillMarkdown(
  markdown: string,
  directoryName: string,
  sourceLabel: string,
): AgentSkill {
  const frontmatter = parseFrontmatter(markdown);
  const id = normalizeSkillId(frontmatter.name || directoryName);
  const name = frontmatter.name || directoryName;
  const description =
    frontmatter.description || firstParagraph(markdown) || `Workspace skill: ${name}`;

  return {
    id,
    name,
    description,
    markdown,
    category: sourceLabel,
    source: "user",
    trustLevel: "markdown_only",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
  };
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const data: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (!key || rest.length === 0) {
      continue;
    }

    data[key.trim()] = rest.join(":").trim().replace(/^["']|["']$/g, "");
  }

  return data;
}

function firstParagraph(markdown: string): string {
  return markdown
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, "")
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s*/, "").trim())
    .find(Boolean) ?? "";
}

function dedupeSkills(skills: AgentSkill[]): AgentSkill[] {
  const byId = new Map<string, AgentSkill>();
  for (const skill of skills) {
    byId.set(skill.id, skill);
  }

  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function selectRelevantSkills(skills: AgentSkill[], query: string): AgentSkill[] {
  const terms = tokenize(query);
  if (terms.size === 0) {
    return skills.slice(0, 8);
  }

  const scored = skills
    .map((skill) => ({
      skill,
      score: scoreSkill(skill, terms),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.slice(0, 8).map((item) => item.skill);
}

function scoreSkill(skill: AgentSkill, terms: Set<string>): number {
  const text = [
    skill.id,
    skill.name,
    skill.description,
    skill.category,
    skill.markdown.slice(0, 1200),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) {
      score += term.length > 3 ? 2 : 1;
    }
  }

  return score;
}

function tokenize(input: string): Set<string> {
  const stopwords = new Set([
    "make",
    "create",
    "build",
    "generate",
    "simple",
    "app",
    "application",
    "支持",
    "生成",
    "一个",
    "简单",
  ]);
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 2 && !stopwords.has(term)),
  );
}

function normalizeSkillId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace-skill"
  );
}
