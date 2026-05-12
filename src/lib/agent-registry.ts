import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentProfile } from "./mission-runtime";

const defaultDataDir = join(process.cwd(), ".metaflow-data");
const registryFilename = "agents.json";

export function createDefaultAgentProfiles(): AgentProfile[] {
  return [
    {
      id: "planner",
      name: "Planner",
      description: "Breaks a mission into small tasks and chooses the right agent profile for each task.",
      skills: ["mission analysis", "task planning", "agent routing"],
      skillIds: ["system-mission-planning"],
      skillDetails: [
        {
          id: "system-mission-planning",
          name: "Mission Planning",
          description: "Convert a user's mission into sections, feature tasks, dependencies, and agent assignments.",
          markdown: [
            "# Mission Planning",
            "",
            "Use this skill when a broad mission needs to become executable work.",
            "",
            "## Procedure",
            "- Identify the requested outcome and artifact type.",
            "- Split the mission into product sections.",
            "- Create one task per visible feature or verifiable deliverable.",
            "- Assign each task to the best existing agent before proposing a temporary specialist.",
            "- Include required skills, dependencies, and expected artifact for each task.",
          ].join("\n"),
          category: "planning",
          source: "system",
          trustLevel: "markdown_only",
          fileInventory: [{ path: "SKILL.md", kind: "skill" }],
        },
      ],
      instructions: "Plan by mission-specific sections and features. Reuse existing agents and skills before creating temporary specialists.",
      taskScope: "Understand the mission, reuse existing profiles first, and produce a concrete execution plan.",
      successCriteria: [
        "Tasks are specific and independently reviewable.",
        "Each task has an assigned agent.",
        "The plan is short enough for the builder and reviewer to act on.",
      ],
      temporary: false,
      createdBy: "system",
    },
    {
      id: "builder",
      name: "Builder",
      description: "Produces real artifacts for the planned mission tasks.",
      skills: ["artifact generation", "software implementation", "structured output"],
      skillIds: ["system-artifact-generation"],
      skillDetails: [
        {
          id: "system-artifact-generation",
          name: "Artifact Generation",
          description: "Create complete, usable artifacts from assigned feature tasks without placeholder output.",
          markdown: [
            "# Artifact Generation",
            "",
            "Use this skill when the mission requires a real deliverable.",
            "",
            "## Procedure",
            "- Follow the planner-selected artifact kind and required skills.",
            "- Return named fenced code blocks for every generated file.",
            "- For software, produce directly runnable HTML or project files.",
            "- For documents, decks, spreadsheets, research, or automation, produce the matching file format.",
            "- Do not produce a planning page when the user asked for an artifact.",
          ].join("\n"),
          category: "build",
          source: "system",
          trustLevel: "markdown_only",
          fileInventory: [{ path: "SKILL.md", kind: "skill" }],
        },
      ],
      instructions: "Build the requested artifact directly. Prefer complete runnable output over explanations.",
      taskScope: "Build the requested artifact from the planner task list without using placeholders.",
      successCriteria: [
        "Generated artifacts are complete and runnable when the mission asks for software.",
        "Every file is returned in a named fenced code block.",
        "No fake fallback artifact is emitted when the model cannot complete the work.",
      ],
      temporary: false,
      createdBy: "system",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      description: "Checks whether the artifacts satisfy the mission and requests repairs when needed.",
      skills: ["quality review", "bug detection", "requirements checking"],
      skillIds: ["system-artifact-review"],
      skillDetails: [
        {
          id: "system-artifact-review",
          name: "Artifact Review",
          description: "Check generated output against the original mission and request scoped repairs.",
          markdown: [
            "# Artifact Review",
            "",
            "Use this skill after artifacts have been generated.",
            "",
            "## Procedure",
            "- Compare the artifact to the original mission.",
            "- Check completeness, obvious bugs, usability, and missing required behavior.",
            "- Return only concrete required fixes.",
            "- Pass the artifact when remaining concerns are optional polish.",
          ].join("\n"),
          category: "quality",
          source: "system",
          trustLevel: "markdown_only",
          fileInventory: [{ path: "SKILL.md", kind: "skill" }],
        },
      ],
      instructions: "Review against the user's mission, not generic preferences. Ask for repair only when required.",
      taskScope: "Review the builder output against the original mission and identify required fixes.",
      successCriteria: [
        "The review states whether the mission is satisfied.",
        "Issues are concrete and actionable.",
        "Repair requests stay scoped to the mission.",
      ],
      temporary: false,
      createdBy: "system",
    },
  ];
}

export class FileAgentRegistry {
  private readonly filePath: string;

  constructor(private readonly dataDir = defaultDataDir) {
    this.filePath = join(dataDir, registryFilename);
  }

  async list(): Promise<AgentProfile[]> {
    return this.readAgents();
  }

  async get(id: string): Promise<AgentProfile | null> {
    const agents = await this.readAgents();
    return agents.find((agent) => agent.id === id) ?? null;
  }

  async upsert(agent: AgentProfile): Promise<AgentProfile> {
    const agents = await this.readAgents();
    const normalized = normalizeAgentProfile(agent);
    const exists = agents.some((item) => item.id === normalized.id);
    const nextAgents = exists
      ? agents.map((item) => (item.id === normalized.id ? normalized : item))
      : [...agents, normalized];

    await this.writeAgents(nextAgents);
    return normalized;
  }

  private async readAgents(): Promise<AgentProfile[]> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      if (!Array.isArray(parsed)) {
        return this.seedDefaults();
      }

      const agents = parsed.filter(isAgentProfile);
      if (agents.length === 0) {
        return this.seedDefaults();
      }

      return mergeDefaultAgents(agents);
    } catch {
      return this.seedDefaults();
    }
  }

  private async seedDefaults(): Promise<AgentProfile[]> {
    const agents = createDefaultAgentProfiles();
    await this.writeAgents(agents);
    return agents;
  }

  private async writeAgents(agents: AgentProfile[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(agents, null, 2)}\n`, "utf8");
  }
}

function mergeDefaultAgents(agents: AgentProfile[]): AgentProfile[] {
  const existingIds = new Set(agents.map((agent) => agent.id));
  const missingDefaults = createDefaultAgentProfiles().filter(
    (agent) => !existingIds.has(agent.id),
  );

  return [...missingDefaults, ...agents];
}

function normalizeAgentProfile(agent: AgentProfile): AgentProfile {
  const id = slugify(agent.id || agent.name);

  return {
    ...agent,
    id,
    name: agent.name.trim() || id,
    description: agent.description.trim(),
    skills: agent.skills.map((skill) => skill.trim()).filter(Boolean),
    skillIds: normalizeStringList(agent.skillIds),
    skillDetails: normalizeAgentSkills(agent.skillDetails),
    instructions: agent.instructions?.trim() || undefined,
    taskScope: agent.taskScope.trim(),
    successCriteria: agent.successCriteria
      .map((criterion) => criterion.trim())
      .filter(Boolean),
    temporary: Boolean(agent.temporary),
    createdBy: agent.createdBy === "meta-agent" ? "meta-agent" : "system",
    source:
      agent.source === "market" || agent.source === "user" || agent.source === "system"
        ? agent.source
        : agent.createdBy === "system"
          ? "system"
          : "user",
    marketId: agent.marketId?.trim() || undefined,
    category: agent.category?.trim() || undefined,
    tags: agent.tags?.map((tag) => tag.trim()).filter(Boolean) ?? undefined,
    originUrl: agent.originUrl?.trim() || undefined,
    license: agent.license?.trim() || undefined,
    installedAt: agent.installedAt?.trim() || undefined,
  };
}

function isAgentProfile(value: unknown): value is AgentProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const agent = value as Record<string, unknown>;
  return (
    typeof agent.id === "string" &&
    typeof agent.name === "string" &&
    typeof agent.description === "string" &&
    Array.isArray(agent.skills) &&
    agent.skills.every((skill) => typeof skill === "string") &&
    (agent.skillIds === undefined ||
      (Array.isArray(agent.skillIds) && agent.skillIds.every((skill) => typeof skill === "string"))) &&
    (agent.skillDetails === undefined ||
      (Array.isArray(agent.skillDetails) && agent.skillDetails.every(isAgentSkill))) &&
    (agent.instructions === undefined || typeof agent.instructions === "string") &&
    typeof agent.taskScope === "string" &&
    Array.isArray(agent.successCriteria) &&
    agent.successCriteria.every((criterion) => typeof criterion === "string") &&
    typeof agent.temporary === "boolean" &&
    (agent.createdBy === "system" || agent.createdBy === "meta-agent") &&
    (agent.source === undefined ||
      agent.source === "system" ||
      agent.source === "user" ||
      agent.source === "market") &&
    (agent.marketId === undefined || typeof agent.marketId === "string") &&
    (agent.category === undefined || typeof agent.category === "string") &&
    (agent.tags === undefined ||
      (Array.isArray(agent.tags) && agent.tags.every((tag) => typeof tag === "string"))) &&
    (agent.originUrl === undefined || typeof agent.originUrl === "string") &&
    (agent.license === undefined || typeof agent.license === "string") &&
    (agent.installedAt === undefined || typeof agent.installedAt === "string")
  );
}

function normalizeStringList(value: string[] | undefined): string[] | undefined {
  const normalized = value?.map((item) => item.trim()).filter(Boolean);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeAgentSkills(skills: AgentProfile["skillDetails"]): AgentProfile["skillDetails"] {
  const normalized = skills
    ?.map((skill) => ({
      ...skill,
      id: slugify(skill.id || skill.name),
      name: skill.name.trim(),
      description: skill.description.trim(),
      markdown: skill.markdown.trim(),
      category: skill.category?.trim() || undefined,
      originUrl: skill.originUrl?.trim() || undefined,
      fileInventory: skill.fileInventory?.filter((entry) => entry.path.trim()),
    }))
    .filter((skill) => skill.name && skill.description && skill.markdown);

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isAgentSkill(value: unknown): value is NonNullable<AgentProfile["skillDetails"]>[number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const skill = value as Record<string, unknown>;
  return (
    typeof skill.id === "string" &&
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    typeof skill.markdown === "string" &&
    (skill.category === undefined || typeof skill.category === "string") &&
    (skill.source === undefined ||
      skill.source === "system" ||
      skill.source === "market" ||
      skill.source === "user") &&
    (skill.originUrl === undefined || typeof skill.originUrl === "string") &&
    (skill.trustLevel === undefined ||
      skill.trustLevel === "markdown_only" ||
      skill.trustLevel === "assets" ||
      skill.trustLevel === "scripts_executables") &&
    (skill.fileInventory === undefined ||
      (Array.isArray(skill.fileInventory) &&
        skill.fileInventory.every(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof (entry as Record<string, unknown>).path === "string" &&
            typeof (entry as Record<string, unknown>).kind === "string",
        )))
  );
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `agent-${Date.now()}`;
}
