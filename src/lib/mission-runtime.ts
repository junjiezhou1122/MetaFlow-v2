import { CompositeBackend, StateBackend, createDeepAgent } from "deepagents";
import { tool } from "langchain";
import { z } from "zod";
import type { SubAgent } from "deepagents";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";

import { createDefaultAgentProfiles } from "./agent-registry";
import { createMemoryBackend } from "./memory-store";

export { createDefaultAgentProfiles } from "./agent-registry";

export type CapabilityType = "agent" | "tool" | "workflow" | "template";

export type Capability = {
  id: string;
  type: CapabilityType;
  name: string;
  description: string;
  tags: string[];
  skillName?: string;
  artifactKinds?: string[];
  installHint?: string;
  reliability: "stable" | "experimental";
};

export type AgentProfile = {
  id: string;
  name: string;
  description: string;
  skills: string[];
  skillIds?: string[];
  skillDetails?: AgentSkill[];
  instructions?: string;
  taskScope: string;
  successCriteria: string[];
  temporary: boolean;
  createdBy: "system" | "meta-agent";
  source?: "system" | "user" | "market";
  marketId?: string;
  category?: string;
  tags?: string[];
  originUrl?: string;
  license?: string;
  installedAt?: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  markdown: string;
  category?: string;
  source?: "system" | "market" | "user";
  originUrl?: string;
  trustLevel?: "markdown_only" | "assets" | "scripts_executables";
  fileInventory?: Array<{
    path: string;
    kind: "skill" | "markdown" | "reference" | "script" | "asset" | "other";
  }>;
};

type DeepAgentSkillFile = {
  path: string;
  content: string;
  mimeType: string;
  created_at: string;
  modified_at: string;
};

export type MissionTask = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  status: "queued" | "running" | "reviewing" | "done";
  section?: string;
  feature?: string;
  goal?: string;
  assignedAgentId?: string;
  requiredSkills?: string[];
  requiredSkillIds?: string[];
  dependencies?: string[];
  expectedArtifact?: string;
};

export type MissionEvent = {
  id: string;
  type:
    | "mission.created"
    | "capability.selected"
    | "agent.created"
    | "task.assigned"
    | "task.started"
    | "task.reviewed"
    | "task.repaired"
    | "mission.failed"
    | "mission.ready";
  message: string;
};

export type MissionArtifact = {
  id: string;
  type: "html" | "react" | "javascript" | "typescript" | "css" | "json" | "markdown" | "text";
  filename: string;
  title: string;
  content: string;
  description: string;
};

export type MissionRunLog = {
  agent: string;
  taskId: string;
  level: "info" | "warning" | "error";
  message: string;
};

export type MissionRunReport = {
  finalBrief?: string;
  tasks?: MissionTask[];
  runLogs?: MissionRunLog[];
  artifactKind?: string;
  requiredSkills?: string[];
  selectedCapabilityIds?: string[];
};

export type MissionReview = {
  passed: boolean;
  issues: string[];
  requiredFixes: string[];
  summary: string;
};

export type MissionPreview = {
  mission: string;
  artifactKind?: string;
  requiredSkills?: string[];
  selectedCapabilities: Capability[];
  ephemeralAgents: AgentProfile[];
  tasks: MissionTask[];
  events: MissionEvent[];
  finalBrief: string;
  runLogs?: MissionRunLog[];
  artifacts?: MissionArtifact[];
  mode?: MissionRuntimeMode;
  finalOutput?: string;
  error?: string;
  provider?: {
    provider: string;
    configured: boolean;
    baseUrl: string;
    keyPreview: string;
    model: string;
  };
};

export type MetaAgentDefinition = {
  name: "meta-agent";
  systemPrompt: string;
  tools: Array<{ name: string; description: string }>;
  subagents: SubAgent[];
};

export type MissionRuntimeMode = "preview" | "deepagents";

export type MissionChatModel = {
  invoke(messages: Array<{ role: string; content: string }>): Promise<{ content: unknown }>;
};

type MissionDeepAgentModel = MissionChatModel | BaseLanguageModel;

type DeepAgentRunner = {
  invoke(input: unknown): Promise<unknown>;
  streamEvents?: (
    input: unknown,
    options: { version: "v2" },
  ) => AsyncIterable<unknown>;
};

type NativeTaskTracker = {
  tasks: MissionTask[];
  activeTaskId?: string;
};

type NativeTodoItem = {
  content: string;
  status?: string;
};

export type MissionProgressStage =
  | "planning"
  | "building"
  | "reviewing"
  | "repairing"
  | "done";

export type MissionProgressUpdate = {
  stage: MissionProgressStage;
  preview: MissionPreview;
};

export const __missionRuntimeTestUtils = {
  createArtifactHandoffDeepAgent,
  createDeepAgentSkillFiles,
  createNativeArtifactClosureInput,
  ensureSkillFrontmatter,
  normalizeDeepAgentSkillName,
};

function appendRuntimeEvent(
  events: MissionEvent[],
  type: MissionEvent["type"],
  message: string,
): MissionEvent[] {
  return [
    ...events,
    {
      id: `event-${events.length + 1}`,
      type,
      message,
    },
  ];
}

function appendUniqueRuntimeEvent(
  events: MissionEvent[],
  type: MissionEvent["type"],
  message: string,
): MissionEvent[] {
  if (events.some((event) => event.type === type && event.message === message)) {
    return events;
  }

  return appendRuntimeEvent(events, type, message);
}

const reusableNeedTags = new Set([
  "research",
  "search",
  "write",
  "report",
  "review",
  "compare",
  "analysis",
  "code",
  "software",
  "build",
]);

export function createDefaultCapabilityRegistry(): Capability[] {
  return [
    {
      id: "web-research",
      type: "tool",
      name: "Web research",
      description: "Finds current sources, extracts useful facts, and keeps citations.",
      tags: ["research", "search", "source", "market", "competitor", "latest"],
      reliability: "stable",
    },
    {
      id: "report-writer",
      type: "agent",
      name: "Report writer",
      description: "Turns structured findings into concise user-facing reports.",
      tags: ["write", "report", "memo", "summary", "positioning"],
      reliability: "stable",
    },
    {
      id: "critical-review",
      type: "agent",
      name: "Critical reviewer",
      description: "Checks gaps, unsupported claims, and whether the answer satisfies the mission.",
      tags: ["review", "critique", "quality", "risk"],
      reliability: "stable",
    },
    {
      id: "comparison-workflow",
      type: "workflow",
      name: "Comparison workflow",
      description: "Builds a comparison matrix before producing a recommendation.",
      tags: ["compare", "analysis", "matrix", "recommendation"],
      reliability: "stable",
    },
    {
      id: "app-builder",
      type: "agent",
      name: "App builder",
      description: "Produces small runnable web application artifacts for simple software missions.",
      tags: [
        "code",
        "software",
        "build",
        "app",
        "web",
        "todo",
        "todolist",
      ],
      reliability: "stable",
    },
    {
      id: "presentation-builder",
      type: "tool",
      name: "Presentations skill",
      description:
        "Local OpenAI Presentations plugin. Creates, edits, renders, verifies, and exports editable PowerPoint PPTX slide decks.",
      tags: [
        "ppt",
        "pptx",
        "powerpoint",
        "presentation",
        "presentations",
        "slides",
        "deck",
        "slide",
        "keynote",
        "路演",
        "融资",
        "演示",
        "幻灯片",
      ],
      skillName: "presentations",
      artifactKinds: ["slide_deck", "pptx"],
      installHint:
        "Bundled locally via OpenAI Presentations plugin; external candidates include anthropics/skills@pptx and googleworkspace/cli@recipe-create-presentation.",
      reliability: "stable",
    },
  ];
}

export function buildMissionPreview(
  mission: string,
  registry = createDefaultCapabilityRegistry(),
): MissionPreview {
  const selectedCapabilities = selectCapabilities(mission, registry);
  const ephemeralAgents =
    selectedCapabilities.length > 0 ? [] : [createEphemeralAgent(mission)];
  const actors = [
    ...selectedCapabilities.map((capability) => capability.name),
    ...ephemeralAgents.map((agent) => agent.name),
  ];
  const tasks = createTasks(mission, actors);
  const events = createEvents(mission, selectedCapabilities, ephemeralAgents, tasks);

  return {
    mission,
    selectedCapabilities,
    ephemeralAgents,
    tasks,
    events,
    finalBrief: [
      "Meta Agent will reuse known capabilities first.",
      ephemeralAgents.length > 0
        ? "A temporary specialist is created only for the uncovered part of the mission."
        : "No temporary agents are needed for this mission.",
      "Every task produces logs and artifacts before the final synthesis.",
    ].join(" "),
  };
}

export function createMetaAgentDefinition(
  registry: Capability[],
  agentProfiles = createDefaultAgentProfiles(),
): MetaAgentDefinition {
  const searchCapabilities = tool(
    ({ query }) =>
      JSON.stringify(
        selectCapabilities(query, registry).map((capability) => ({
          id: capability.id,
          name: capability.name,
          description: capability.description,
          skillName: capability.skillName,
          artifactKinds: capability.artifactKinds,
          installHint: capability.installHint,
        })),
      ),
    {
      name: "search_capabilities",
      description: "Search reusable agents, tools, workflows, and templates before creating anything new.",
      schema: z.object({
        query: z.string().describe("The mission or task need to match against known capabilities."),
      }),
    },
  );

  const createEphemeral = tool(
    ({ mission }) => JSON.stringify(createEphemeralAgent(mission)),
    {
      name: "create_ephemeral_agent",
      description: "Create one scoped temporary agent only when existing capabilities do not cover the need.",
      schema: z.object({
        mission: z.string().describe("The uncovered mission need."),
      }),
    },
  );

  const assignTask = tool(
    ({ task, agent }) =>
      JSON.stringify({
        task,
        agent,
        status: "assigned",
      }),
    {
      name: "assign_task",
      description: "Assign a clear task to an existing or temporary agent.",
      schema: z.object({
        task: z.string().describe("The task to assign."),
        agent: z.string().describe("The target agent or capability name."),
      }),
    },
  );

  const submitArtifact = createSubmitArtifactTool();

  const researcher: SubAgent = {
    name: "researcher",
    description: "Searches for existing information and summarizes cited findings.",
    systemPrompt: "You are a focused research agent. Reuse available tools before reasoning from memory.",
    tools: [searchCapabilities],
    skills: ["/skills/"],
  };

  const reviewer: SubAgent = {
    name: "reviewer",
    description: "Reviews plans and outputs for gaps, unsupported claims, and user fit.",
    systemPrompt: "You are a strict reviewer. Check whether each task output satisfies its success criteria.",
    skills: ["/skills/"],
  };

  const profileSubagents = agentProfiles.map(agentProfileToSubAgent);

  return {
    name: "meta-agent",
    systemPrompt:
      [
        "You are Meta Agent, a calm orchestrator.",
        "Use the DeepAgents task tool to delegate substantial mission sections to available subagents.",
        "Use write_todos for the mission plan, and read relevant SKILL.md files before executing specialized work.",
        "Write todos as feature-level items in this exact content shape: Section / User-visible feature name: concrete task. The Feature part must be specific, never the generic word Feature. Do not use file paths as the section/feature separator.",
        "Search existing capabilities and skills first, create temporary agents only for uncovered needs, assign scoped tasks, monitor progress, request revisions, and synthesize the final result in user-friendly language.",
        "Use write_file to save every final user-facing deliverable under /artifacts/ before the final response.",
        "Call submit_artifact with every complete final deliverable before ending the run.",
        "When producing artifacts, return named fenced code blocks for every generated file.",
      ].join(" "),
    tools: [searchCapabilities, createEphemeral, assignTask, submitArtifact].map((item) => ({
      name: item.name,
      description: item.description,
    })),
    subagents: [...profileSubagents, researcher, reviewer],
  };
}

export function createMetaDeepAgent(
  registry = createDefaultCapabilityRegistry(),
  model?: BaseLanguageModel,
  agentProfiles = createDefaultAgentProfiles(),
) {
  const definition = createMetaAgentDefinition(registry, agentProfiles);

  return createDeepAgent({
    model,
    systemPrompt: definition.systemPrompt,
    tools: createMetaAgentTools(registry),
    skills: ["/skills/"],
    memory: ["/memories/preferences.md", "/memories/meta-agent-lessons.md"],
    backend: createMetaAgentBackend(),
    subagents: definition.subagents,
  });
}

function createMetaAgentBackend() {
  return new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": createMemoryBackend(),
    },
  );
}

function createArtifactHandoffDeepAgent(model?: BaseLanguageModel) {
  return createDeepAgent({
    model,
    systemPrompt: [
      "You are Artifact Handoff Agent.",
      "Your only job is to produce complete final user-facing files from the existing mission context.",
      "Do not plan, delegate, assign tasks, search capabilities, create agents, or summarize instead of producing files.",
      "Use write_file under /artifacts/ and call submit_artifact with the complete final file content before ending.",
      "If the mission can be satisfied by one web file, write and submit /artifacts/index.html.",
      "If unsure, produce the smallest usable MVP artifact that directly satisfies the mission.",
    ].join(" "),
    tools: [createSubmitArtifactTool()],
    subagents: [],
  });
}

function agentProfileToSubAgent(agent: AgentProfile): SubAgent {
  return {
    name: agent.id,
    description: [
      agent.description,
      agent.skills.length ? `Skills: ${agent.skills.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    systemPrompt: formatAgentRuntimeContext(agent),
    skills: ["/skills/"],
  };
}

function createDeepAgentSkillFiles(agentProfiles: AgentProfile[]): Record<string, DeepAgentSkillFile> {
  const now = new Date().toISOString();
  const files: Record<string, DeepAgentSkillFile> = {};

  for (const skill of collectAgentSkills(agentProfiles)) {
    const slug = normalizeDeepAgentSkillName(skill.id || skill.name);
    const content = ensureSkillFrontmatter(skill, slug);
    files[`/skills/${slug}/SKILL.md`] = {
      path: `/skills/${slug}/SKILL.md`,
      ...createDeepAgentTextFile(content, "text/markdown", now),
    };
  }

  return files;
}

function collectAgentSkills(agentProfiles: AgentProfile[]): AgentSkill[] {
  const skillsById = new Map<string, AgentSkill>();
  for (const agent of agentProfiles) {
    for (const skill of agent.skillDetails ?? []) {
      skillsById.set(skill.id, skill);
    }
  }

  return [...skillsById.values()];
}

function ensureSkillFrontmatter(skill: AgentSkill, slug: string): string {
  const body = skill.markdown.trim();
  if (/^---\s*\n[\s\S]*?\n---\s*\n/.test(body)) {
    return body.replace(/^---\s*\n([\s\S]*?)\n---/, (match, frontmatter: string) => {
      const hasName = /^name:\s*/m.test(frontmatter);
      const hasDescription = /^description:\s*/m.test(frontmatter);
      if (hasName && hasDescription) {
        return match;
      }

      return [
        "---",
        hasName ? "" : `name: ${slug}`,
        hasDescription ? "" : `description: ${quoteYaml(skill.description)}`,
        frontmatter,
        "---",
      ]
        .filter((line) => line !== "")
        .join("\n");
    });
  }

  return [
    "---",
    `name: ${slug}`,
    `description: ${quoteYaml(skill.description)}`,
    skill.originUrl ? `metadata:\n  origin: ${quoteYaml(skill.originUrl)}` : "",
    "---",
    "",
    body,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function normalizeDeepAgentSkillName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return normalized || "metaflow-skill";
}

function createDeepAgentTextFile(
  content: string,
  mimeType = "text/plain",
  timestamp = new Date().toISOString(),
): Omit<DeepAgentSkillFile, "path"> {
  return {
    content,
    mimeType,
    created_at: timestamp,
    modified_at: timestamp,
  };
}

function quoteYaml(value: string): string {
  return JSON.stringify(value.trim());
}

function formatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export async function runMission(
  mission: string,
  provider?: MissionPreview["provider"],
  model?: MissionChatModel | null,
): Promise<MissionPreview> {
  return runMultiAgentMission(mission, provider, model, createDefaultAgentProfiles());
}

export async function runMultiAgentMission(
  mission: string,
  provider?: MissionPreview["provider"],
  model?: MissionChatModel | null,
  agentProfiles = createDefaultAgentProfiles(),
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
): Promise<MissionPreview> {
  if (!model) {
    const preview = buildMissionPreview(mission);
    return {
      ...preview,
      artifacts: [],
      finalBrief:
        "No live model is configured, so MetaFlow did not generate artifacts. Add a provider key to run DeepAgents for real output.",
      mode: "preview",
      provider,
    };
  }

  if (isDeepAgentCompatibleModel(model)) {
    return runNativeDeepAgentMission(mission, provider, model, agentProfiles, onProgress);
  }

  const preview = buildMissionPreview(mission);
  try {
    const runLogs: MissionRunLog[] = [];
    let events = [...preview.events];

    const planner = findAgent(agentProfiles, "planner");
    const builder = findAgent(agentProfiles, "builder");
    const reviewer = findAgent(agentProfiles, "reviewer");

    events = appendRuntimeEvent(
      events,
      "task.started",
      "Meta Agent started mission decomposition.",
    );
    const plannerOutput = await runPlannerAgentWithRepair(mission, preview, planner, model);
    const plannedTasks = createDynamicExecutionTasks(
      plannerOutput.tasks,
      mission,
      agentProfiles,
    );
    runLogs.push({
      agent: planner.name,
      taskId: "planner",
      level: "info",
      message: plannerOutput.finalBrief,
    });
    events = appendRuntimeEvent(
      events,
      "task.assigned",
      `Meta Agent planned ${plannedTasks.length} feature-level task(s) across ${countAssignedAgents(
        plannedTasks,
      )} agent(s).`,
    );
    events = appendTaskAssignmentEvents(events, plannedTasks);
    await onProgress?.({
      stage: "planning",
      preview: {
        ...preview,
        tasks: plannedTasks,
        events,
        runLogs: [...runLogs],
        artifactKind: plannerOutput.artifactKind,
        requiredSkills: plannerOutput.requiredSkills,
        mode: "deepagents",
        provider,
        finalBrief: plannerOutput.finalBrief,
      },
    });

    const buildTask = selectArtifactTask(plannedTasks);
    const buildTaskIds = selectImplementationTaskIds(plannedTasks, buildTask.id);
    events = appendRuntimeEvent(
      events,
      "task.started",
      `${buildTask.assignedTo} started ${buildTaskIds.length} feature task(s).`,
    );
    const buildingTasks = markTasksRunning(plannedTasks, buildTaskIds);
    await onProgress?.({
      stage: "building",
      preview: {
        ...preview,
        tasks: buildingTasks,
        events,
        runLogs: [...runLogs],
        artifactKind: plannerOutput.artifactKind,
        requiredSkills: plannerOutput.requiredSkills,
        mode: "deepagents",
        provider,
        finalBrief: "Builder is generating artifacts.",
      },
    });
    const builderOutput = await runBuilderAgent(
      mission,
      buildingTasks,
      builder,
      model,
      plannerOutput,
    );
    let artifacts = extractArtifactsFromText(builderOutput);
    runLogs.push({
      agent: builder.name,
      taskId: buildTaskIds.join(","),
      level: artifacts.length > 0 ? "info" : "warning",
      message:
        artifacts.length > 0
          ? `Generated ${artifacts.length} artifact file(s).`
          : "Builder returned no artifact blocks.",
    });
    events = appendRuntimeEvent(
      events,
      "task.started",
      `${buildTask.assignedTo} completed ${buildTaskIds.length} feature task(s) and produced ${artifacts.length} artifact file(s).`,
    );
    const afterBuildTasks = markTasksDone(plannedTasks, buildTaskIds);
    const reviewTask = selectReviewTask(afterBuildTasks);
    const reviewingTasks = markTaskReviewing(afterBuildTasks, reviewTask.id);
    await onProgress?.({
      stage: "building",
      preview: {
        ...preview,
        tasks: afterBuildTasks,
        events,
        runLogs: [...runLogs],
        artifacts,
        mode: "deepagents",
        provider,
        finalBrief: "Builder generated artifacts. Reviewer is checking the output.",
        finalOutput: builderOutput,
      },
    });

    events = appendRuntimeEvent(
      events,
      "task.reviewed",
      `${reviewTask.assignedTo} started: ${reviewTask.title}.`,
    );
    await onProgress?.({
      stage: "reviewing",
      preview: {
        ...preview,
        tasks: reviewingTasks,
        events,
        runLogs: [...runLogs],
        artifacts,
        mode: "deepagents",
        provider,
        finalBrief: "Reviewer is checking the generated artifacts.",
        finalOutput: builderOutput,
      },
    });
    const modelReview = await runReviewerAgentSafely(
      mission,
      reviewingTasks,
      artifacts,
      reviewer,
      model,
    );
    const localReview = reviewArtifactsLocally(mission, artifacts);
    const review = mergeReviews(modelReview, localReview);
    runLogs.push({
      agent: reviewer.name,
      taskId: "reviewer",
      level: review.passed && review.issues.length === 0 ? "info" : "warning",
      message: review.summary,
    });
    events = appendRuntimeEvent(
      events,
      "task.reviewed",
      `Reviewer completed artifact review: ${review.summary}`,
    );
    await onProgress?.({
      stage: "reviewing",
      preview: {
        ...preview,
        tasks: reviewingTasks,
        events,
        runLogs: [...runLogs],
        artifacts,
        mode: "deepagents",
        provider,
        finalBrief: review.summary,
        finalOutput: [builderOutput, formatReviewOutput(review)].join("\n\n"),
      },
    });

    let finalOutput = [builderOutput, formatReviewOutput(review)].join("\n\n");
    let finalReview = review;
    let runError: string | undefined;
    if (!review.passed && review.requiredFixes.length > 0) {
      events = appendRuntimeEvent(
        events,
        "task.repaired",
        "Builder started one repair pass from reviewer feedback.",
      );
      await onProgress?.({
        stage: "repairing",
        preview: {
          ...preview,
          tasks: reviewingTasks,
          events,
          runLogs: [...runLogs],
          artifacts,
          mode: "deepagents",
          provider,
          finalBrief: "Builder is repairing the artifact from reviewer feedback.",
          finalOutput,
        },
      });
      const repairOutput = await runRepairAgent(
        mission,
        artifacts,
        review,
        builder,
        model,
      );
      const repairedArtifacts = extractArtifactsFromText(repairOutput);
      if (repairedArtifacts.length > 0) {
        artifacts = repairedArtifacts;
      }
      finalOutput = [builderOutput, formatReviewOutput(review), repairOutput].join("\n\n");
      runError =
        repairedArtifacts.length > 0
          ? undefined
          : "Reviewer requested repair, but Builder did not return a repaired artifact.";
      finalReview = {
        passed: repairedArtifacts.length > 0,
        issues: repairedArtifacts.length > 0 ? [] : review.issues,
        requiredFixes: repairedArtifacts.length > 0 ? [] : review.requiredFixes,
        summary:
          repairedArtifacts.length > 0
            ? "Reviewer requested repair; Builder completed one repair pass."
            : "Reviewer requested repair, but Builder did not return a repaired artifact.",
      };
      runLogs.push({
        agent: builder.name,
        taskId: "repair",
        level: repairedArtifacts.length > 0 ? "info" : "error",
        message: finalReview.summary,
      });
      events = appendRuntimeEvent(
        events,
        repairedArtifacts.length > 0 ? "task.repaired" : "mission.failed",
        finalReview.summary,
      );
      await onProgress?.({
        stage: "repairing",
        preview: {
          ...preview,
          tasks: reviewingTasks,
          events,
          runLogs: [...runLogs],
          artifacts,
          mode: "deepagents",
          provider,
          finalBrief: finalReview.summary,
          finalOutput,
        },
      });
    }

    events = appendRuntimeEvent(
      events,
      runError ? "mission.failed" : "mission.ready",
      runError ?? "Mission completed with usable artifacts.",
    );

    return {
      ...preview,
      tasks: completeAllTasks(reviewingTasks),
      events,
      runLogs,
      artifactKind: plannerOutput.artifactKind,
      requiredSkills: plannerOutput.requiredSkills,
      artifacts,
      mode: "deepagents",
      finalOutput,
      error: runError,
      finalBrief:
        artifacts.length > 0
          ? finalReview.summary
          : "DeepAgents completed the multi-agent run, but no artifact code blocks were found in the model output.",
      provider,
    };
  } catch (error) {
    return {
      ...preview,
      artifacts: [],
      events: appendRuntimeEvent(
        preview.events,
        "mission.failed",
        error instanceof Error ? error.message : "DeepAgents run failed.",
      ),
      mode: "preview",
      error: error instanceof Error ? error.message : "DeepAgents run failed.",
      finalBrief:
        "The live DeepAgents run failed, so MetaFlow did not generate artifacts.",
      provider,
    };
  }
}

async function runNativeDeepAgentMission(
  mission: string,
  provider: MissionPreview["provider"] | undefined,
  model: BaseLanguageModel,
  agentProfiles: AgentProfile[],
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
): Promise<MissionPreview> {
  const preview = buildMissionPreview(mission);
  let events = appendRuntimeEvent(
    preview.events,
    "task.started",
    "Meta Agent started native DeepAgents execution with skill middleware.",
  );
  const skillFiles = createDeepAgentSkillFiles(agentProfiles);
  const agent = createMetaDeepAgent(
    createDefaultCapabilityRegistry(),
    model,
    agentProfiles,
  ) as DeepAgentRunner;

  await onProgress?.({
    stage: "planning",
    preview: {
      ...preview,
      events,
      finalBrief: "DeepAgents is planning with native todos, task delegation, and skill discovery.",
      mode: "deepagents",
      provider,
    },
  });

  try {
    const input = {
      messages: [
        {
          role: "user",
          content: [
            `Mission: ${mission}`,
            "",
            "Execute this mission end to end.",
            "Use write_todos to plan.",
            "Each todo content must be one feature-level task formatted as: Section / User-visible feature name: concrete task.",
            "The Feature part must be specific, for example Counter controls, Reset action, Login form, Summary cards. Never use the generic word Feature.",
            "A mission may have many sections, and each section may have many features. Prefer one todo per feature.",
            "Use available subagents through the task tool when work can be split.",
            "Use the skills system: inspect available skills and read relevant SKILL.md files before specialized work.",
            "Save final user-facing deliverables with write_file under /artifacts/.",
            "For a single-file web app, write /artifacts/index.html.",
            "For React projects, write files under /artifacts/src/ plus package files as needed.",
            "For decks/documents/research outputs, write the matching final artifact under /artifacts/.",
            "Before finishing, call submit_artifact for each final deliverable with the complete file content.",
            "Return final deliverables as named fenced code blocks. For web apps, include a runnable HTML file or React project files.",
            "Do not finish with only a summary; the final answer must include artifact files either in /artifacts/ state files, named fenced code blocks, or both.",
            "Also include a fenced JSON block named mission-run.json with finalBrief, runLogs, and tasks.",
          ].join("\n"),
        },
      ],
      files: skillFiles,
    };
    const streamed = await runNativeDeepAgentWithEvents(
      agent,
      input,
      preview,
      events,
      provider,
      agentProfiles,
      onProgress,
    );
    events = streamed.events;
    if (streamed.error) {
      events = appendUniqueRuntimeEvent(
        events,
        "task.started",
        `DeepAgents stream stopped before artifact handoff: ${streamed.error}`,
      );
    }
    const result = streamed.result;
    const output = extractDeepAgentOutput(result);
    const artifacts = mergeArtifacts(
      extractArtifactsFromText(output),
      extractArtifactsFromDeepAgentFiles(result),
    );
    let report = extractRunReportFromText(output);
    if (artifacts.length === 0) {
      events = appendRuntimeEvent(
        events,
        "task.started",
        "Native DeepAgents is completing the artifact handoff before fallback.",
      );
      await onProgress?.({
        stage: "building",
        preview: {
          ...preview,
          tasks: streamed.tasks ?? preview.tasks,
          events,
          finalBrief: "DeepAgents is completing the artifact handoff.",
          mode: "deepagents",
          provider,
          finalOutput: output,
        },
      });

      const closureInput = createNativeArtifactClosureInput(
        mission,
        skillFiles,
        result,
        output,
      );
      const closureAgent = createArtifactHandoffDeepAgent(model) as DeepAgentRunner;
      const closure = await runNativeDeepAgentWithEvents(
        closureAgent,
        closureInput,
        {
          ...preview,
          tasks: streamed.tasks ?? preview.tasks,
        },
        events,
        provider,
        agentProfiles,
        onProgress,
      );
      events = closure.events;
      const closureOutput = [output, extractDeepAgentOutput(closure.result)]
        .filter(Boolean)
        .join("\n\n");
      const closureArtifacts = mergeArtifacts(
        extractArtifactsFromText(closureOutput),
        extractArtifactsFromDeepAgentFiles(closure.result),
      );

      if (closureArtifacts.length > 0) {
        report = extractRunReportFromText(closureOutput) ?? report;
        return buildNativeDeepAgentPreview(
          preview,
          events,
          closureArtifacts,
          report,
          closureOutput,
          agentProfiles,
          provider,
          closure.tasks ?? streamed.tasks,
        );
      }

      return runFallbackDirectMissionAfterNativeAttempt(
        mission,
        provider,
        model,
        agentProfiles,
        preview,
        events,
        closureOutput,
        closure.tasks ?? streamed.tasks,
        onProgress,
      );
    }
    const finalPreview = buildNativeDeepAgentPreview(
      preview,
      events,
      artifacts,
      report,
      output,
      agentProfiles,
      provider,
      streamed.tasks,
    );

    await onProgress?.({
      stage: "done",
      preview: finalPreview,
    });

    return finalPreview;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Native DeepAgents run failed.";
    return {
      ...preview,
      artifacts: [],
      events: appendRuntimeEvent(events, "mission.failed", message),
      mode: "preview",
      error: message,
      finalBrief: "Native DeepAgents failed before producing artifacts.",
      provider,
    };
  }
}

function buildNativeDeepAgentPreview(
  preview: MissionPreview,
  nativeEvents: MissionEvent[],
  artifacts: MissionArtifact[],
  report: MissionRunReport | null,
  output: string,
  agentProfiles: AgentProfile[],
  provider: MissionPreview["provider"] | undefined,
  trackedTasks?: MissionTask[],
): MissionPreview {
  const tasks =
    report?.tasks && report.tasks.length > 0
      ? completeAllTasks(createDynamicExecutionTasks(report.tasks, preview.mission, agentProfiles))
      : trackedTasks && trackedTasks.length > 0
        ? completeAllTasks(trackedTasks)
        : completeAllTasks(createDynamicExecutionTasks([], preview.mission, agentProfiles));
  const runLogs =
    report?.runLogs && report.runLogs.length > 0
      ? report.runLogs
      : [
          {
            agent: "Meta Agent",
            taskId: "native-deepagents",
            level: artifacts.length > 0 ? "info" : "warning",
            message:
              artifacts.length > 0
                ? `Native DeepAgents generated ${artifacts.length} artifact file(s).`
                : "Native DeepAgents completed without named artifact blocks.",
          } satisfies MissionRunLog,
        ];
  const error =
    artifacts.length > 0
      ? undefined
      : "Mission did not produce a usable artifact.";
  const events = appendRuntimeEvent(
    nativeEvents,
    error ? "mission.failed" : "mission.ready",
    error ?? "Native DeepAgents completed the mission.",
  );

  return {
    ...preview,
    tasks,
    events,
    runLogs,
    artifacts,
    mode: "deepagents",
    finalOutput: output,
    error,
    finalBrief:
      report?.finalBrief ??
      (artifacts.length > 0
        ? "Native DeepAgents completed the mission with generated artifacts."
        : "Native DeepAgents completed, but no artifact code blocks were found."),
    provider,
  };
}

function createNativeArtifactClosureInput(
  mission: string,
  _skillFiles: Record<string, DeepAgentSkillFile>,
  previousResult: unknown,
  previousOutput: string,
) {
  return {
    messages: [
      {
        role: "user",
        content: [
          `Mission: ${mission}`,
          "",
          "Complete the native DeepAgents artifact handoff before any fallback is allowed.",
          "You already planned and inspected context. Now finish the smallest usable MVP deliverable.",
          "Do not call assign_task, task delegation, create_ephemeral_agent, or search_capabilities.",
          "Use write_file under /artifacts/ and call submit_artifact with the complete final file content.",
          "For a single-file web app, submit /artifacts/index.html.",
          "Do not return only a summary. Do not ask questions. Do not create a planning page.",
          "",
          "Previous native DeepAgents output:",
          summarizePreviousNativeOutput(previousOutput),
        ].join("\n"),
      },
    ],
    files: extractArtifactFileRecord(previousResult),
  };
}

function summarizePreviousNativeOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "No text output.";
  }

  const compact = trimmed.replace(/\s+/g, " ");
  return compact.length > 2000 ? `${compact.slice(0, 2000).trim()}...` : compact;
}

async function runFallbackDirectMissionAfterNativeAttempt(
  mission: string,
  provider: MissionPreview["provider"] | undefined,
  model: MissionChatModel,
  agentProfiles: AgentProfile[],
  preview: MissionPreview,
  nativeEvents: MissionEvent[],
  nativeOutput: string,
  nativeTasks?: MissionTask[],
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
): Promise<MissionPreview> {
  let events = appendRuntimeEvent(
    nativeEvents,
    "task.started",
    "Native DeepAgents produced no artifact blocks; falling back to direct artifact builder.",
  );
  const builder = findAgent(agentProfiles, "builder");
  const reviewer = findAgent(agentProfiles, "reviewer");
  const tasks =
    nativeTasks && nativeTasks.length > 0
      ? createDynamicExecutionTasks(
          ensureNativeFallbackReviewTask(nativeTasks, mission, agentProfiles),
          mission,
          agentProfiles,
        )
      : createDynamicExecutionTasks([], mission, agentProfiles);
  const runLogs: MissionRunLog[] = [
    {
      agent: "Meta Agent",
      taskId: "native-deepagents",
      level: "warning",
      message: "Native DeepAgents completed without named artifact blocks.",
    },
  ];

  events = appendRuntimeEvent(
    events,
    "task.assigned",
    `Meta Agent prepared ${tasks.length} direct fallback task(s) across ${countAssignedAgents(
      tasks,
    )} agent(s).`,
  );
  events = appendTaskAssignmentEvents(events, tasks);
  await onProgress?.({
    stage: "planning",
    preview: {
      ...preview,
      tasks,
      events,
      runLogs,
      finalBrief: "Meta Agent is skipping replanning and sending the mission directly to Builder.",
      mode: "deepagents",
      provider,
      finalOutput: nativeOutput,
    },
  });

  const buildingTasks = markTasksRunning(
    tasks,
    selectImplementationTaskIds(tasks, selectArtifactTask(tasks).id),
  );

  await onProgress?.({
    stage: "building",
    preview: {
      ...preview,
      tasks: buildingTasks,
      events,
      runLogs,
      finalBrief: "Direct builder is generating artifacts after native DeepAgents produced no artifact.",
      mode: "deepagents",
      provider,
      finalOutput: nativeOutput,
    },
  });

  const builderOutput = await runWithProgressHeartbeat(
    () =>
      runBuilderAgent(mission, buildingTasks, builder, model, {
        artifactKind: "web_app",
        requiredSkills: ["artifact generation"],
        selectedCapabilityIds: ["app-builder"],
      }),
    () => ({
      stage: "building",
      preview: {
        ...preview,
        tasks: buildingTasks,
        events: appendUniqueRuntimeEvent(
          events,
          "task.started",
          `${builder.name} is still generating the artifact.`,
        ),
        runLogs,
        finalBrief: "Builder is still generating the artifact.",
        mode: "deepagents",
        provider,
        finalOutput: nativeOutput,
      },
    }),
    onProgress,
  );
  const artifacts = extractArtifactsFromText(builderOutput);
  const afterBuildTasks = markTasksDone(
    tasks,
    selectImplementationTaskIds(tasks, selectArtifactTask(tasks).id),
  );
  runLogs.push({
    agent: builder.name,
    taskId: "fallback-build",
    level: artifacts.length > 0 ? "info" : "error",
    message:
      artifacts.length > 0
        ? `Fallback builder generated ${artifacts.length} artifact file(s).`
        : "Fallback builder returned no artifact blocks.",
  });
  const review = await runReviewerAgentSafely(
    mission,
    afterBuildTasks,
    artifacts,
    reviewer,
    model,
  );
  const error = artifacts.length > 0 ? undefined : "Mission did not produce a usable artifact.";
  events = appendRuntimeEvent(
    events,
    error ? "mission.failed" : "mission.ready",
    error ?? "Fallback builder produced usable artifacts.",
  );
  runLogs.push({
    agent: reviewer.name,
    taskId: "fallback-review",
    level: review.passed ? "info" : "warning",
    message: review.summary,
  });

  return {
    ...preview,
    tasks: completeAllTasks(afterBuildTasks),
    events,
    runLogs,
    artifactKind: "web_app",
    requiredSkills: ["artifact generation"],
    artifacts,
    mode: "deepagents",
    finalOutput: [nativeOutput, builderOutput, formatReviewOutput(review)].join("\n\n"),
    error,
    finalBrief:
      artifacts.length > 0
        ? "Native DeepAgents handled planning and skill discovery; fallback builder produced the artifact."
        : "Native DeepAgents and fallback builder completed, but no artifact code blocks were found.",
    provider,
  };
}

async function runNativeDeepAgentWithEvents(
  agent: DeepAgentRunner,
  input: unknown,
  preview: MissionPreview,
  initialEvents: MissionEvent[],
  provider: MissionPreview["provider"] | undefined,
  agentProfiles: AgentProfile[] = createDefaultAgentProfiles(),
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
): Promise<{
  result: unknown;
  events: MissionEvent[];
  error?: string;
  wroteArtifact?: boolean;
  wroteArtifactWithoutContent?: boolean;
  tasks?: MissionTask[];
}> {
  if (typeof agent.streamEvents !== "function") {
    try {
      return {
        result: await agent.invoke(input),
        events: initialEvents,
        tasks: preview.tasks,
      };
    } catch (error) {
      return {
        result: "",
        events: initialEvents,
        error: formatErrorMessage(error, "Native DeepAgents invoke failed."),
        tasks: preview.tasks,
      };
    }
  }

  let events = initialEvents;
  let result: unknown;
  let streamedFiles: Record<string, unknown> = {};
  let streamError: string | undefined;
  let wroteArtifact = false;
  let wroteArtifactWithoutContent = false;
  let readFileEventsWithoutArtifact = 0;
  let tracker: NativeTaskTracker = {
    tasks: [...preview.tasks],
  };

  try {
    for await (const streamEvent of agent.streamEvents(input, { version: "v2" })) {
      const eventFiles = extractStreamEventFiles(streamEvent);
      tracker = updateNativeTaskTrackerFromEvent(
        tracker,
        streamEvent,
        preview.mission,
        [...agentProfiles, ...preview.ephemeralAgents],
      );
      tracker = mergeNativeTrackerWithOutputTodos(
        tracker,
        extractStreamText(streamEvent),
        preview.mission,
        agentProfiles,
      );
      if (
        isArtifactWriteEndEvent(streamEvent) &&
        Object.keys(eventFiles).length === 0
      ) {
        wroteArtifactWithoutContent = true;
      }
      streamedFiles = {
        ...streamedFiles,
        ...eventFiles,
      };
      if (isToolEndEvent(streamEvent, "read_file")) {
        readFileEventsWithoutArtifact += 1;
      }
      if (
        isEarlyArtifactStreamEvent(streamEvent) &&
        extractArtifactsFromDeepAgentFiles({ files: eventFiles }).length > 0
      ) {
        wroteArtifact = true;
        tracker = mergeNativeTrackerWithOutputTodos(
          tracker,
          extractStreamText(streamEvent),
          preview.mission,
          agentProfiles,
        );
        const message = formatDeepAgentStreamEvent(streamEvent);
        if (message) {
          events = appendUniqueRuntimeEvent(events, streamEventType(message), message);
          await onProgress?.({
            stage: progressStageForStreamMessage(message),
            preview: {
              ...preview,
              tasks: tracker.tasks,
              events,
              finalBrief: message,
              mode: "deepagents",
              provider,
            },
          });
        }
        return {
          result: mergeDeepAgentRunResult(result ?? "", streamedFiles),
          events,
          tasks: tracker.tasks,
          wroteArtifact,
          wroteArtifactWithoutContent,
        };
      }

      const output = extractStreamEventOutput(streamEvent);
      if (output !== undefined) {
        result = mergeDeepAgentRunResult(output, streamedFiles);
        tracker = mergeNativeTrackerWithOutputTodos(
          tracker,
          extractDeepAgentOutput(result),
          preview.mission,
          agentProfiles,
        );
      }

      const message = formatDeepAgentStreamEvent(streamEvent);
      if (!message) {
        continue;
      }

      events = appendUniqueRuntimeEvent(events, streamEventType(message), message);
      await onProgress?.({
        stage: progressStageForStreamMessage(message),
        preview: {
          ...preview,
          tasks: tracker.tasks,
          events,
          finalBrief: message,
          mode: "deepagents",
          provider,
        },
      });
      if (wroteArtifactWithoutContent || readFileEventsWithoutArtifact >= 6) {
        return {
          result: mergeDeepAgentRunResult(result ?? "", streamedFiles),
          events,
          tasks: tracker.tasks,
          error: wroteArtifactWithoutContent
            ? "Native DeepAgents wrote a file without returning file content."
            : "Native DeepAgents stalled on repeated read_file events.",
          wroteArtifact,
          wroteArtifactWithoutContent,
        };
      }
    }
  } catch (error) {
    streamError = formatErrorMessage(error, "Native DeepAgents stream failed.");
  }

  return {
    result: mergeDeepAgentRunResult(result ?? "", streamedFiles),
    events,
    tasks: tracker.tasks,
    error: streamError,
    wroteArtifact,
    wroteArtifactWithoutContent,
  };
}

function updateNativeTaskTrackerFromEvent(
  tracker: NativeTaskTracker,
  event: unknown,
  mission: string,
  agents: AgentProfile[],
): NativeTaskTracker {
  if (!event || typeof event !== "object") {
    return tracker;
  }

  const value = event as Record<string, unknown>;
  const eventName = typeof value.event === "string" ? value.event : "";
  const runnableName = typeof value.name === "string" ? value.name : "";
  const data = value.data && typeof value.data === "object"
    ? (value.data as Record<string, unknown>)
    : {};

  if (eventName === "on_tool_start" && runnableName === "write_todos") {
    const todoTasks = createTasksFromNativeTodos(
      extractTodoItems(data.input),
      mission,
      agents,
    );
    if (todoTasks.length === 0) {
      return tracker;
    }

    return {
      ...tracker,
      tasks: mergeNativeTasks(tracker.tasks, todoTasks),
    };
  }

  if (eventName === "on_tool_start" && runnableName === "task") {
    const input = data.input && typeof data.input === "object"
      ? (data.input as Record<string, unknown>)
      : {};
    const description =
      typeof input.description === "string" && input.description.trim()
        ? input.description.trim()
        : summarizeUnknown(input);
    const assignedAgent = resolveNativeSubagent(input.subagent_type, description, agents);
    let tasks = tracker.tasks;
    if (tasks.length === 0) {
      tasks = [
        createNativeMissionTask({
          index: 0,
          mission,
          agents,
          content: description,
          status: "running",
          assignedAgent,
        }),
      ];
    }

    const taskId = matchNativeTaskId(tasks, description) ?? tasks[0]!.id;
    return {
      activeTaskId: taskId,
      tasks: tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "running",
              assignedTo: assignedAgent.name,
              assignedAgentId: assignedAgent.id,
              requiredSkills: task.requiredSkills?.length
                ? task.requiredSkills
                : assignedAgent.skills.slice(0, 3),
              requiredSkillIds:
                task.requiredSkillIds?.length
                  ? task.requiredSkillIds
                  : assignedAgent.skillIds?.slice(0, 3) ??
                    assignedAgent.skillDetails?.map((skill) => skill.id).slice(0, 3),
            }
          : task.status === "running"
            ? { ...task, status: "queued" }
            : task,
      ),
    };
  }

  if (eventName === "on_tool_end" && runnableName === "task") {
    const output = summarizeUnknown(data.output);
    const taskId = tracker.activeTaskId ?? matchNativeTaskId(tracker.tasks, output);
    if (!taskId) {
      return tracker;
    }

    return {
      activeTaskId: undefined,
      tasks: markTasksDone(tracker.tasks, [taskId]),
    };
  }

  if (
    eventName === "on_tool_end" &&
    (runnableName === "submit_artifact" || runnableName === "write_file")
  ) {
    return {
      ...tracker,
      tasks: tracker.tasks.length > 0 ? completeAllTasks(tracker.tasks) : tracker.tasks,
    };
  }

  return tracker;
}

function mergeNativeTrackerWithOutputTodos(
  tracker: NativeTaskTracker,
  output: string,
  mission: string,
  agents: AgentProfile[],
): NativeTaskTracker {
  const todoTasks = createTasksFromNativeTodos(
    extractTodoItemsFromText(output),
    mission,
    agents,
  );
  if (todoTasks.length === 0) {
    return tracker;
  }

  return {
    ...tracker,
    tasks: mergeNativeTasks(tracker.tasks, todoTasks),
  };
}

function createTasksFromNativeTodos(
  todos: NativeTodoItem[],
  mission: string,
  agents: AgentProfile[],
): MissionTask[] {
  return todos
    .filter((todo) => todo.content.trim())
    .slice(0, 12)
    .map((todo, index) =>
      createNativeMissionTask({
        index,
        mission,
        agents,
        content: todo.content,
        status: mapNativeTodoStatus(todo.status),
      }),
    );
}

function extractTodoItems(input: unknown): NativeTodoItem[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) {
    return [];
  }

  return todos
    .map((todo): NativeTodoItem | null => {
      if (typeof todo === "string") {
        const content = todo.trim();
        return content ? { content } : null;
      }
      if (!todo || typeof todo !== "object") {
        return null;
      }

      const record = todo as Record<string, unknown>;
      const content =
        typeof record.content === "string"
          ? record.content.trim()
          : typeof record.task === "string"
            ? record.task.trim()
            : "";
      if (!content) {
        return null;
      }

      return {
        content,
        status: typeof record.status === "string" ? record.status : undefined,
      };
    })
    .filter((todo): todo is NativeTodoItem => !!todo);
}

function extractTodoItemsFromText(text: string): NativeTodoItem[] {
  const marker = "Updated todo list to ";
  const items: NativeTodoItem[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const markerIndex = text.indexOf(marker, searchIndex);
    if (markerIndex < 0) {
      break;
    }

    const startIndex = text.indexOf("[", markerIndex + marker.length);
    if (startIndex < 0) {
      break;
    }

    const jsonText = extractBalancedJsonArray(text, startIndex);
    if (jsonText) {
      items.push(...extractTodoItems({ todos: parseUnknownJson(jsonText) }));
      searchIndex = startIndex + jsonText.length;
    } else {
      searchIndex = startIndex + 1;
    }
  }

  return items;
}

function extractBalancedJsonArray(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "[") {
      depth += 1;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseUnknownJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function ensureNativeFallbackReviewTask(
  tasks: MissionTask[],
  mission: string,
  agents: AgentProfile[],
): MissionTask[] {
  if (tasks.some((task) => isReviewTask(task))) {
    return tasks;
  }

  const reviewer = findAgent(agents, "reviewer");
  return [
    ...tasks,
    {
      id: "native-review",
      title: "Review artifact",
      description: `Check whether the generated artifact satisfies: ${mission}`,
      assignedTo: reviewer.name,
      assignedAgentId: reviewer.id,
      section: "Quality",
      feature: "Acceptance check",
      requiredSkills: reviewer.skills.slice(0, 3),
      requiredSkillIds:
        reviewer.skillIds?.slice(0, 3) ??
        reviewer.skillDetails?.map((skill) => skill.id).slice(0, 3),
      dependencies: tasks.length > 0 ? [tasks[tasks.length - 1]!.id] : [],
      expectedArtifact: "acceptance review",
      status: "queued",
    },
  ];
}

function createNativeMissionTask({
  index,
  mission,
  agents,
  content,
  status,
  assignedAgent,
}: {
  index: number;
  mission: string;
  agents: AgentProfile[];
  content: string;
  status: MissionTask["status"];
  assignedAgent?: AgentProfile;
}): MissionTask {
  const parsed = parseNativeSectionFeature(content);
  const agent = assignedAgent ?? resolveNativeSubagent(undefined, content, agents);
  const title = parsed.feature || parsed.title || `Feature ${index + 1}`;

  return {
    id: `native-task-${slugifyTaskId(`${parsed.section}-${title}`) || index + 1}`,
    title,
    description: parsed.description || content || `Implement feature for: ${mission}`,
    assignedTo: agent.name,
    assignedAgentId: agent.id,
    section: parsed.section,
    feature: parsed.feature || title,
    requiredSkills: agent.skills.slice(0, 3),
    requiredSkillIds:
      agent.skillIds?.slice(0, 3) ??
      agent.skillDetails?.map((skill) => skill.id).slice(0, 3),
    dependencies: [],
    expectedArtifact: isReviewLikeText(content) ? "acceptance review" : "feature artifact",
    status,
  };
}

function parseNativeSectionFeature(content: string): {
  section?: string;
  feature?: string;
  title?: string;
  description?: string;
} {
  const trimmed = content.trim().replace(/^\s*[-*]\s*/, "");
  const [head, ...descriptionParts] = trimmed.split(":");
  const description = descriptionParts.join(":").trim() || undefined;
  const normalizedHead = head?.trim() || trimmed;
  const slashParts = normalizedHead
    .split(/\s+(?:\/|>|->|::)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (slashParts.length >= 2) {
    return {
      section: slashParts[0],
      feature: slashParts.slice(1).join(" / "),
      title: slashParts.slice(1).join(" / "),
      description,
    };
  }

  return {
    section: inferNativeSection(trimmed),
    feature: normalizedHead,
    title: normalizedHead,
    description,
  };
}

function inferNativeSection(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (isReviewLikeText(text)) return "Quality";
  if (/auth|login|signup|password|form|账户|登录|注册/.test(lower)) return "Auth";
  if (/dashboard|overview|metric|summary|数据|概览|仪表盘/.test(lower)) return "Dashboard";
  if (/setting|config|preference|设置|配置/.test(lower)) return "Settings";
  if (/persist|storage|save|localstorage|保存|存储/.test(lower)) return "Persistence";
  if (/ui|layout|style|responsive|界面|布局|样式/.test(lower)) return "Interface";
  return "Feature";
}

function mapNativeTodoStatus(status: string | undefined): MissionTask["status"] {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "done";
  }
  if (normalized === "in_progress" || normalized === "in-progress" || normalized === "running") {
    return "running";
  }
  if (normalized === "reviewing" || normalized === "review") {
    return "reviewing";
  }
  return "queued";
}

function mergeNativeTasks(existing: MissionTask[], incoming: MissionTask[]): MissionTask[] {
  const merged = [...existing];

  for (const task of incoming) {
    const index = merged.findIndex((item) => nativeTaskKey(item) === nativeTaskKey(task));
    if (index >= 0) {
      merged[index] = {
        ...merged[index]!,
        ...task,
        id: merged[index]!.id,
        status:
          merged[index]!.status === "running" && task.status === "queued"
            ? "running"
            : task.status,
      };
    } else {
      merged.push(task);
    }
  }

  return merged;
}

function nativeTaskKey(task: MissionTask): string {
  return `${task.section ?? ""}:${task.feature ?? task.title}`.toLowerCase();
}

function resolveNativeSubagent(
  subagentType: unknown,
  text: string,
  agents: AgentProfile[],
): AgentProfile {
  const requested = typeof subagentType === "string" ? subagentType.trim().toLowerCase() : "";
  return (
    agents.find((agent) => agent.id.toLowerCase() === requested) ??
    agents.find((agent) => agent.name.toLowerCase() === requested) ??
    agents.find((agent) => requested && requested.includes(agent.id.toLowerCase())) ??
    findAgent(
      agents,
      isReviewLikeText(text)
        ? "reviewer"
        : isPlanningLikeText(text)
          ? "planner"
          : "builder",
    )
  );
}

function isReviewLikeText(text: string): boolean {
  return /review|qa|test|verify|quality|acceptance|检查|测试|验证|审核/.test(
    text.toLowerCase(),
  );
}

function isPlanningLikeText(text: string): boolean {
  return /plan|research|scope|requirements|context|规划|调研|需求|拆解/.test(
    text.toLowerCase(),
  );
}

function matchNativeTaskId(tasks: MissionTask[], text: string): string | undefined {
  const tokens = tokenizeTaskText(text);
  if (tokens.length === 0) {
    return tasks.find((task) => task.status === "queued")?.id ?? tasks[0]?.id;
  }

  const scored = tasks
    .map((task) => ({
      task,
      score: scoreTaskMatch(task, tokens),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (best && best.score > 0) {
    return best.task.id;
  }

  return tasks.find((task) => task.status === "queued")?.id ?? tasks[0]?.id;
}

function scoreTaskMatch(task: MissionTask, tokens: string[]): number {
  const haystack = tokenizeTaskText(
    [
      task.section,
      task.feature,
      task.title,
      task.description,
      task.expectedArtifact,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const haystackSet = new Set(haystack);
  return tokens.filter((token) => haystackSet.has(token)).length;
}

function tokenizeTaskText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !["the", "and", "for", "with", "this", "that", "into"].includes(token));
}

function slugifyTaskId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isArtifactWriteEndEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }

  const value = event as Record<string, unknown>;
  return (
    value.event === "on_tool_end" &&
    (value.name === "write_file" || value.name === "submit_artifact")
  );
}

function isToolEndEvent(event: unknown, toolName: string): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }

  const value = event as Record<string, unknown>;
  return value.event === "on_tool_end" && value.name === toolName;
}

function isEarlyArtifactStreamEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }

  const value = event as Record<string, unknown>;
  return (
    value.event === "on_tool_end" &&
    (value.name === "write_file" ||
      value.name === "submit_artifact" ||
      value.name === "task")
  );
}

function progressStageForStreamMessage(message: string): MissionProgressStage {
  if (message.includes("write_file") || message.includes("submitted artifact")) {
    return "building";
  }
  if (message.includes("completed task") || message.includes("completed tool")) {
    return "reviewing";
  }
  return "planning";
}

export async function runMissionIteration(
  originalMission: string,
  followUpPrompt: string,
  previousPreview: MissionPreview | null,
  provider?: MissionPreview["provider"],
  model?: MissionChatModel | null,
  agentProfiles = createDefaultAgentProfiles(),
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
): Promise<MissionPreview> {
  if (!model) {
    return {
      ...(previousPreview ?? buildMissionPreview(originalMission)),
      finalBrief:
        "No live model is configured, so MetaFlow could not update the artifact.",
      mode: "preview",
      provider,
      error: "No live model is configured.",
    };
  }

  const basePreview = previousPreview ?? buildMissionPreview(originalMission);
  const existingArtifacts = basePreview.artifacts ?? [];
  if (isDeepAgentCompatibleModel(model)) {
    return runNativeDeepAgentIteration(
      originalMission,
      followUpPrompt,
      basePreview,
      existingArtifacts,
      provider,
      model,
      agentProfiles,
      onProgress,
    );
  }

  const missionContext = [
    `Original mission: ${originalMission}`,
    `New user prompt: ${followUpPrompt}`,
  ].join("\n");
  const runLogs: MissionRunLog[] = [...(basePreview.runLogs ?? [])];
  let events: MissionEvent[] =
    basePreview.events.some(
      (event) => event.message === `User added a follow-up prompt: ${followUpPrompt}`,
    )
      ? [...basePreview.events]
      : appendRuntimeEvent(
          basePreview.events,
          "task.started",
          `User added a follow-up prompt: ${followUpPrompt}`,
        );
  const planner = findAgent(agentProfiles, "planner");
  const builder = findAgent(agentProfiles, "builder");
  const reviewer = findAgent(agentProfiles, "reviewer");

  try {
    const plannerOutput = await runPlannerAgentWithRepair(
      missionContext,
      basePreview,
      planner,
      model,
    );
    const plannedTasks = createDynamicExecutionTasks(
      plannerOutput.tasks,
      followUpPrompt,
      agentProfiles,
    );

    runLogs.push({
      agent: planner.name,
      taskId: "planner",
      level: "info",
      message: plannerOutput.finalBrief,
    });
    events = appendRuntimeEvent(
      events,
      "task.assigned",
      `Meta Agent replanned ${plannedTasks.length} feature-level follow-up task(s) across ${countAssignedAgents(
        plannedTasks,
      )} agent(s).`,
    );
    events = appendTaskAssignmentEvents(events, plannedTasks);
    await onProgress?.({
      stage: "planning",
      preview: {
        ...basePreview,
        tasks: plannedTasks,
        events,
        runLogs: [...runLogs],
        artifacts: existingArtifacts,
        artifactKind: plannerOutput.artifactKind ?? basePreview.artifactKind,
        requiredSkills: plannerOutput.requiredSkills ?? basePreview.requiredSkills,
        mode: "deepagents",
        provider,
        finalBrief: plannerOutput.finalBrief,
      },
    });

    const buildTask = selectArtifactTask(plannedTasks);
    const buildTaskIds = selectImplementationTaskIds(plannedTasks, buildTask.id);
    const buildingTasks = markTasksRunning(plannedTasks, buildTaskIds);
    events = appendRuntimeEvent(
      events,
      "task.started",
      `${buildTask.assignedTo} started ${buildTaskIds.length} feature task(s).`,
    );
    await onProgress?.({
      stage: "building",
      preview: {
        ...basePreview,
        tasks: buildingTasks,
        events,
        runLogs: [...runLogs],
        artifacts: existingArtifacts,
        artifactKind: plannerOutput.artifactKind ?? basePreview.artifactKind,
        requiredSkills: plannerOutput.requiredSkills ?? basePreview.requiredSkills,
        mode: "deepagents",
        provider,
        finalBrief: "Builder is updating the existing artifact.",
      },
    });

    const builderOutput = await runIterationBuilderAgent(
      originalMission,
      followUpPrompt,
      existingArtifacts,
      buildingTasks,
      builder,
      model,
      plannerOutput,
    );
    let artifacts = mergeArtifacts(existingArtifacts, extractArtifactsFromText(builderOutput));
    runLogs.push({
      agent: builder.name,
      taskId: buildTaskIds.join(","),
      level: artifacts.length > 0 ? "info" : "warning",
      message:
        artifacts.length > 0
          ? `Updated ${artifacts.length} artifact file(s).`
          : "Builder returned no updated artifact blocks.",
    });
    events = appendRuntimeEvent(
      events,
      artifacts.length > 0 ? "task.started" : "mission.failed",
      artifacts.length > 0
        ? `${buildTask.assignedTo} completed ${buildTaskIds.length} feature task(s) and updated ${artifacts.length} artifact file(s).`
        : "Builder returned no updated artifact blocks.",
    );

    const afterBuildTasks = markTasksDone(plannedTasks, buildTaskIds);
    const reviewTask = selectReviewTask(afterBuildTasks);
    const reviewingTasks = markTaskReviewing(afterBuildTasks, reviewTask.id);
    events = appendRuntimeEvent(
      events,
      "task.reviewed",
      `${reviewTask.assignedTo} started: ${reviewTask.title}.`,
    );
    await onProgress?.({
      stage: "reviewing",
      preview: {
        ...basePreview,
        tasks: reviewingTasks,
        events,
        runLogs: [...runLogs],
        artifacts,
        artifactKind: plannerOutput.artifactKind ?? basePreview.artifactKind,
        requiredSkills: plannerOutput.requiredSkills ?? basePreview.requiredSkills,
        mode: "deepagents",
        provider,
        finalBrief: "Reviewer is checking the updated artifacts.",
        finalOutput: builderOutput,
      },
    });

    const review = mergeReviews(
      await runReviewerAgentSafely(
        missionContext,
        reviewingTasks,
        artifacts,
        reviewer,
        model,
      ),
      reviewArtifactsLocally(missionContext, artifacts),
    );
    runLogs.push({
      agent: reviewer.name,
      taskId: "reviewer",
      level: review.passed && review.issues.length === 0 ? "info" : "warning",
      message: review.summary,
    });
    events = appendRuntimeEvent(
      events,
      "task.reviewed",
      `Reviewer completed artifact review: ${review.summary}`,
    );

    let finalOutput = [builderOutput, formatReviewOutput(review)].join("\n\n");
    let finalReview = review;
    let runError: string | undefined;
    if (!review.passed && review.requiredFixes.length > 0) {
      await onProgress?.({
        stage: "repairing",
        preview: {
          ...basePreview,
          tasks: reviewingTasks,
          events,
          runLogs: [...runLogs],
          artifacts,
          artifactKind: plannerOutput.artifactKind ?? basePreview.artifactKind,
          requiredSkills: plannerOutput.requiredSkills ?? basePreview.requiredSkills,
          mode: "deepagents",
          provider,
          finalBrief: "Builder is repairing the updated artifact.",
          finalOutput,
        },
      });
      const repairOutput = await runRepairAgent(
        missionContext,
        artifacts,
        review,
        builder,
        model,
      );
      const repairedArtifacts = extractArtifactsFromText(repairOutput);
      if (repairedArtifacts.length > 0) {
        artifacts = mergeArtifacts(artifacts, repairedArtifacts);
      }
      finalOutput = [finalOutput, repairOutput].join("\n\n");
      runError =
        repairedArtifacts.length > 0
          ? undefined
          : "Reviewer requested repair, but Builder did not return a repaired artifact.";
      finalReview = {
        passed: repairedArtifacts.length > 0,
        issues: repairedArtifacts.length > 0 ? [] : review.issues,
        requiredFixes: repairedArtifacts.length > 0 ? [] : review.requiredFixes,
        summary:
          repairedArtifacts.length > 0
            ? "Reviewer requested repair; Builder completed one repair pass."
            : "Reviewer requested repair, but Builder did not return a repaired artifact.",
      };
      runLogs.push({
        agent: builder.name,
        taskId: "repair",
        level: repairedArtifacts.length > 0 ? "info" : "error",
        message: finalReview.summary,
      });
      events = appendRuntimeEvent(
        events,
        repairedArtifacts.length > 0 ? "task.repaired" : "mission.failed",
        finalReview.summary,
      );
    }

    events = appendRuntimeEvent(
      events,
      runError ? "mission.failed" : "mission.ready",
      runError ?? "Follow-up completed with updated artifacts.",
    );

    return {
      ...basePreview,
      tasks: completeAllTasks(reviewingTasks),
      events,
      runLogs,
      artifactKind: plannerOutput.artifactKind ?? basePreview.artifactKind,
      requiredSkills: plannerOutput.requiredSkills ?? basePreview.requiredSkills,
      artifacts,
      mode: "deepagents",
      provider,
      finalOutput,
      error: runError,
      finalBrief:
        artifacts.length > 0
          ? finalReview.summary
          : "The follow-up run completed, but no artifact code blocks were found.",
    };
  } catch (error) {
    return {
      ...basePreview,
      events: appendRuntimeEvent(
        events,
        "mission.failed",
        error instanceof Error ? error.message : "Mission update failed.",
      ),
      mode: "preview",
      provider,
      error: error instanceof Error ? error.message : "Mission update failed.",
      finalBrief: "The follow-up run failed, so MetaFlow did not update the artifact.",
    };
  }
}

async function runNativeDeepAgentIteration(
  originalMission: string,
  followUpPrompt: string,
  basePreview: MissionPreview,
  existingArtifacts: MissionArtifact[],
  provider: MissionPreview["provider"] | undefined,
  model: BaseLanguageModel,
  agentProfiles: AgentProfile[],
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
): Promise<MissionPreview> {
  let events = basePreview.events.some(
    (event) => event.message === `User added a follow-up prompt: ${followUpPrompt}`,
  )
    ? [...basePreview.events]
    : appendRuntimeEvent(
        basePreview.events,
        "task.started",
        `User added a follow-up prompt: ${followUpPrompt}`,
      );
  events = appendRuntimeEvent(
    events,
    "task.started",
    "Native DeepAgents is updating the mission from the follow-up prompt.",
  );
  const tasks = createFollowUpTasks(followUpPrompt);
  await onProgress?.({
    stage: "building",
    preview: {
      ...basePreview,
      tasks: markTasksRunning(tasks, ["follow-up-build"]),
      events,
      artifacts: existingArtifacts,
      mode: "deepagents",
      provider,
      finalBrief: "DeepAgents is editing the existing artifact.",
    },
  });

  const input = createNativeFollowUpInput(
    originalMission,
    followUpPrompt,
    existingArtifacts,
  );
  const agent = createArtifactHandoffDeepAgent(model) as DeepAgentRunner;
  const streamed = await runNativeDeepAgentWithEvents(
    agent,
    input,
    basePreview,
    events,
    provider,
    agentProfiles,
    onProgress,
  );
  events = streamed.events;
  const output = extractDeepAgentOutput(streamed.result);
  const nativeArtifacts = mergeArtifacts(
    extractArtifactsFromText(output),
    extractArtifactsFromDeepAgentFiles(streamed.result),
  );
  const nativeChanged = hasArtifactChanges(existingArtifacts, nativeArtifacts);
  if (!streamed.wroteArtifact && (!nativeArtifacts.length || !nativeChanged)) {
    const takeoverMessage = nativeArtifacts.length > 0 && !nativeChanged
      ? "Native DeepAgents returned no changed artifact; direct artifact edit is taking over."
      : streamed.wroteArtifactWithoutContent
      ? "Native DeepAgents wrote a file without returning file content; direct artifact edit is taking over."
      : "Native DeepAgents follow-up stalled on repeated reads; direct artifact edit is taking over.";
    events = appendRuntimeEvent(
      events,
      "task.started",
      takeoverMessage,
    );
    await onProgress?.({
      stage: "building",
      preview: {
        ...basePreview,
        tasks: markTasksRunning(tasks, ["follow-up-build"]),
        events,
        artifacts: existingArtifacts,
        mode: "deepagents",
        provider,
        finalBrief: "Direct artifact edit is applying the follow-up.",
      },
    });

    const directOutput = await runDirectFollowUpEdit(
      originalMission,
      followUpPrompt,
      existingArtifacts,
      findAgent(agentProfiles, "builder"),
      model as unknown as MissionChatModel,
    );
    const directArtifacts = extractArtifactsFromText(directOutput);
    const updatedArtifacts = mergeArtifacts(existingArtifacts, directArtifacts);
    const error =
      directArtifacts.length > 0
        ? undefined
        : streamed.error ?? "Follow-up did not produce an updated artifact.";
    events = appendRuntimeEvent(
      events,
      error ? "mission.failed" : "mission.ready",
      error ?? "Direct artifact edit completed the follow-up update.",
    );

    return buildFollowUpPreview(
      basePreview,
      tasks,
      events,
      existingArtifacts,
      updatedArtifacts,
      provider,
      directOutput,
      error,
    );
  }

  const updatedArtifacts = mergeArtifacts(existingArtifacts, nativeArtifacts);
  const error =
    nativeArtifacts.length > 0 && nativeChanged
      ? undefined
      : streamed.error ?? "Follow-up did not produce an updated artifact.";
  events = appendRuntimeEvent(
    events,
    error ? "mission.failed" : "mission.ready",
    error ?? "Native DeepAgents completed the follow-up update.",
  );

  return buildFollowUpPreview(
    basePreview,
    tasks,
    events,
    existingArtifacts,
    updatedArtifacts,
    provider,
    output,
    error,
  );
}

function createNativeFollowUpInput(
  originalMission: string,
  followUpPrompt: string,
  artifacts: MissionArtifact[],
) {
  return {
    messages: [
      {
        role: "user",
        content: [
          `Original mission: ${originalMission}`,
          `Follow-up prompt: ${followUpPrompt}`,
          "",
          "Update the existing artifact files to satisfy the follow-up prompt.",
          "Preserve existing behavior unless the follow-up explicitly changes it.",
          "Do not create a planning or clarification page.",
          "Write the changed files under /artifacts/ and call submit_artifact with complete file content.",
          "For a single-file web app, update /artifacts/index.html.",
        ].join("\n"),
      },
    ],
    files: artifactsToDeepAgentFiles(artifacts),
  };
}

async function runDirectFollowUpEdit(
  originalMission: string,
  followUpPrompt: string,
  artifacts: MissionArtifact[],
  agent: AgentProfile,
  model: MissionChatModel,
): Promise<string> {
  const tasks = createFollowUpTasks(followUpPrompt);
  return runIterationBuilderAgent(
    originalMission,
    followUpPrompt,
    artifacts,
    tasks,
    agent,
    model,
    {
      artifactKind: artifacts.some((artifact) => artifact.type === "html")
        ? "web_app"
        : undefined,
      requiredSkills: ["artifact editing"],
      selectedCapabilityIds: ["app-builder"],
    },
  );
}

function buildFollowUpPreview(
  basePreview: MissionPreview,
  tasks: MissionTask[],
  events: MissionEvent[],
  existingArtifacts: MissionArtifact[],
  updatedArtifacts: MissionArtifact[],
  provider: MissionPreview["provider"] | undefined,
  finalOutput: string,
  error?: string,
): MissionPreview {
  return {
    ...basePreview,
    tasks: completeAllTasks(tasks),
    events,
    runLogs: [
      ...(basePreview.runLogs ?? []),
      {
        agent: "Native DeepAgents",
        taskId: "follow-up-build",
        level: error ? "error" : "info",
        message: error
          ? error
          : `Updated ${Math.max(updatedArtifacts.length - existingArtifacts.length, 1)} artifact file(s).`,
      },
    ],
    artifacts: updatedArtifacts,
    mode: "deepagents",
    provider,
    finalOutput,
    error,
    finalBrief: error ?? "Updated the existing artifact from the follow-up prompt.",
  };
}

function hasArtifactChanges(
  existingArtifacts: MissionArtifact[],
  candidateArtifacts: MissionArtifact[],
): boolean {
  if (candidateArtifacts.length === 0) {
    return false;
  }

  return candidateArtifacts.some((candidate) => {
    const existing = existingArtifacts.find(
      (artifact) => artifact.filename === candidate.filename,
    );
    return !existing || existing.content.trim() !== candidate.content.trim();
  });
}

function artifactsToDeepAgentFiles(
  artifacts: MissionArtifact[],
): Record<string, DeepAgentSkillFile> {
  const now = new Date().toISOString();
  return Object.fromEntries(
    artifacts.map((artifact) => [
      `/artifacts/${sanitizeFilename(artifact.filename)}`,
      {
        path: `/artifacts/${sanitizeFilename(artifact.filename)}`,
        ...createDeepAgentTextFile(artifact.content, mimeTypeForArtifact(artifact), now),
      },
    ]),
  );
}

function mimeTypeForArtifact(artifact: MissionArtifact): string {
  if (artifact.type === "html") return "text/html";
  if (artifact.type === "css") return "text/css";
  if (artifact.type === "json") return "application/json";
  if (artifact.type === "markdown") return "text/markdown";
  return "text/plain";
}

function createFollowUpTasks(followUpPrompt: string): MissionTask[] {
  return [
    {
      id: "follow-up-build",
      title: "Update artifact",
      description: `Apply follow-up prompt: ${followUpPrompt}`,
      assignedTo: "Native DeepAgents",
      assignedAgentId: "builder",
      requiredSkills: ["artifact editing"],
      expectedArtifact: "updated user artifact",
      status: "queued",
    },
    {
      id: "follow-up-review",
      title: "Review update",
      description: "Check that the updated artifact still satisfies the original mission and follow-up.",
      assignedTo: "Meta Agent",
      assignedAgentId: "reviewer",
      requiredSkills: ["quality review"],
      dependencies: ["follow-up-build"],
      expectedArtifact: "accepted update",
      status: "queued",
    },
  ];
}

async function generateMissionArtifacts(
  mission: string,
  preview: MissionPreview,
  model: MissionChatModel,
): Promise<string> {
  const taskSummary = preview.tasks
    .map(
      (task) =>
        `- ${task.id}: ${task.title} -> ${task.assignedTo}; ${task.description}`,
    )
    .join("\n");
  const capabilitySummary = preview.selectedCapabilities
    .map((capability) => `${capability.name}: ${capability.description}`)
    .join("\n");
  const result = await model.invoke([
    {
      role: "system",
      content: [
        "You are Meta Agent executing a mission through specialized capabilities.",
        "Use the provided capability/task plan as the orchestration record.",
        "Generate real artifacts only. Never use placeholders.",
        "Return one fenced JSON block named mission-run.json.",
        "The mission-run.json shape must be exactly: {\"finalBrief\": string, \"tasks\": [{\"id\": string, \"title\": string, \"description\": string, \"assignedTo\": string, \"status\": \"queued\" | \"running\" | \"reviewing\" | \"done\"}], \"runLogs\": [{\"agent\": string, \"taskId\": string, \"level\": \"info\" | \"warning\" | \"error\", \"message\": string}]}",
        "For every generated file, include a fenced code block with language and filename, for example: ```html filename=\"index.html\".",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Mission: ${mission}`,
        "",
        "Selected capabilities:",
        capabilitySummary || "No reusable capability selected.",
        "",
        "Assigned tasks:",
        taskSummary,
        "",
        "Execute the mission now. If this is a software mission, output complete runnable code.",
      ].join("\n"),
    },
  ]);

  return extractMessageContent(result.content);
}

async function runPlannerAgent(
  mission: string,
  preview: MissionPreview,
  agent: AgentProfile,
  model: MissionChatModel,
): Promise<Required<Pick<MissionRunReport, "tasks" | "finalBrief">> &
  Pick<MissionRunReport, "artifactKind" | "requiredSkills" | "selectedCapabilityIds">> {
  const taskSummary = preview.tasks
    .map((task) => `- ${task.id}: ${task.title}; ${task.description}`)
    .join("\n");
  const capabilitySummary = preview.selectedCapabilities
    .map(
      (capability) =>
        [
          `- ${capability.id}: ${capability.name}`,
          `tags=${capability.tags.join(", ")}`,
          capability.skillName ? `skill=${capability.skillName}` : "",
          capability.artifactKinds?.length
            ? `artifactKinds=${capability.artifactKinds.join(", ")}`
            : "",
          capability.installHint ? `installHint=${capability.installHint}` : "",
          capability.description,
        ]
          .filter(Boolean)
          .join("; "),
    )
    .join("\n");
  const result = await invokeModelWithRetry(model, [
    {
      role: "system",
      content: [
        "You are the Planner agent in a MetaFlow multi-agent run.",
        agent.description,
        formatAgentRuntimeContext(agent),
        "First search/reuse existing capabilities and skills from the registry. Do not guess from hardcoded categories.",
        "Return only a fenced JSON block named planner-output.json.",
        "Shape: {\"finalBrief\": string, \"artifactKind\": string, \"requiredSkills\": string[], \"selectedCapabilityIds\": string[], \"tasks\": [{\"id\": string, \"section\": string, \"feature\": string, \"title\": string, \"description\": string, \"assignedTo\": string, \"assignedAgentId\": string, \"requiredSkills\": string[], \"dependencies\": string[], \"expectedArtifact\": string, \"status\": \"queued\" | \"running\" | \"reviewing\" | \"done\"}]}",
        "Plan by product sections and features. One feature should usually become one task.",
        "For software missions, decompose by user-visible sections such as workspace, projects, board, cards, filters, persistence, settings, sharing, and quality instead of returning one generic build task.",
        "Create mission-specific tasks. Do not force a generic planner/builder/reviewer board. Add review or repair tasks only when they are useful for the mission.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Mission: ${mission}`,
        "",
        "Initial Meta Agent task plan:",
        taskSummary || "No initial tasks.",
        "",
        "Available skill/capability registry:",
        capabilitySummary || "No matching capabilities found yet.",
        "",
        "Create a concise executable plan. Select artifactKind and requiredSkills from the mission and available registry. Prefer existing skills before creating new agent behavior.",
      ].join("\n"),
    },
  ]);

  const report = extractNamedJson(extractMessageContent(result.content), "planner-output.json");
  const tasks = Array.isArray(report?.tasks)
    ? report.tasks.filter(isMissionTask)
    : [];

  return {
    tasks,
    artifactKind:
      typeof report?.artifactKind === "string" && report.artifactKind.trim()
        ? report.artifactKind.trim()
        : undefined,
    requiredSkills: Array.isArray(report?.requiredSkills)
      ? report.requiredSkills.filter((skill): skill is string => typeof skill === "string")
      : undefined,
    selectedCapabilityIds: Array.isArray(report?.selectedCapabilityIds)
      ? report.selectedCapabilityIds.filter((id): id is string => typeof id === "string")
      : undefined,
    finalBrief:
      typeof report?.finalBrief === "string" && report.finalBrief.trim()
        ? report.finalBrief.trim()
      : "Planner created the task plan.",
  };
}

async function runPlannerAgentWithRepair(
  mission: string,
  preview: MissionPreview,
  agent: AgentProfile,
  model: MissionChatModel,
): Promise<Required<Pick<MissionRunReport, "tasks" | "finalBrief">> &
  Pick<MissionRunReport, "artifactKind" | "requiredSkills" | "selectedCapabilityIds">> {
  const firstPlan = await runPlannerAgent(mission, preview, agent, model);
  if (firstPlan.tasks.length > 0 && !isCoarseTaskPlan(firstPlan.tasks, mission)) {
    return firstPlan;
  }

  const repairPreview: MissionPreview = {
    ...preview,
    tasks: firstPlan.tasks,
    artifactKind: firstPlan.artifactKind,
    requiredSkills: firstPlan.requiredSkills,
    finalBrief: [
      firstPlan.finalBrief,
      "The previous planner output was too coarse. Return mission-specific section/feature tasks with concrete expected artifacts.",
    ].join("\n"),
  };
  const repairedPlan = await runPlannerAgent(mission, repairPreview, agent, model);
  if (repairedPlan.tasks.length > 0 && !isCoarseTaskPlan(repairedPlan.tasks, mission)) {
    return {
      ...repairedPlan,
      finalBrief: repairedPlan.finalBrief || "Planner repaired the task plan.",
    };
  }

  return firstPlan.tasks.length > 0 ? firstPlan : repairedPlan;
}

async function runBuilderAgent(
  mission: string,
  tasks: MissionTask[],
  agent: AgentProfile,
  model: MissionChatModel,
  plan: Pick<MissionRunReport, "artifactKind" | "requiredSkills" | "selectedCapabilityIds"> = {},
): Promise<string> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    {
      role: "system",
      content: [
        "You are Builder.",
        `Planner artifactKind: ${plan.artifactKind ?? "unspecified"}`,
        `Planner requiredSkills: ${(plan.requiredSkills ?? []).join(", ") || "none"}`,
        `Planner selectedCapabilityIds: ${(plan.selectedCapabilityIds ?? []).join(", ") || "none"}`,
        formatAgentRuntimeContext(agent),
        "Generate real artifacts only. Never use placeholders.",
        "Return named fenced code blocks for every file you create.",
        "Follow the planner artifactKind and requiredSkills. Do not re-classify the mission from keywords.",
        "Build the smallest usable MVP first, not the complete dream app.",
        "The MVP must be immediately usable and easy for the user to improve with follow-up prompts.",
        "Include only the core workflow needed to prove the mission works.",
        "If the plan uses a web app skill, return runnable HTML or React project files.",
        "If the plan uses a presentation skill, return a deck artifact such as ```markdown filename=\"deck.md\"` or another named deck file requested by the plan.",
        "If the plan uses a document, spreadsheet, image, research, or automation skill, return the matching named artifact file(s).",
        "Implement the user's requested artifact directly.",
        "Do not build a requirements clarification page, task planner, proposal, or explanation page.",
        "Prefer a compact MVP artifact over a large unfinished response.",
        "Keep the output concise but complete. No explanation.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Mission: ${mission}`,
        "Create the first usable MVP artifact directly using the planner-selected skill direction.",
        "Do not ask follow-up questions. Do not create a requirements clarification page.",
        `Required task: ${tasks.find((task) => task.assignedTo === "Builder")?.description ?? "Build a complete runnable artifact."}`,
        "Keep scope small: one artifact, core workflow only, complete enough to use immediately.",
        "Use the planner artifactKind and requiredSkills to choose the artifact format.",
      ].join("\n"),
    },
  ];

  const result = await invokeModelWithRetry(model, messages);
  const content = extractMessageContent(result.content);

  if (extractArtifactsFromText(content).length > 0) {
    return content;
  }

  return repairOutputFormat(model, content, "The Builder agent returned no named artifact code block.");
}

async function runIterationBuilderAgent(
  originalMission: string,
  followUpPrompt: string,
  artifacts: MissionArtifact[],
  tasks: MissionTask[],
  agent: AgentProfile,
  model: MissionChatModel,
  plan: Pick<MissionRunReport, "artifactKind" | "requiredSkills" | "selectedCapabilityIds"> = {},
): Promise<string> {
  const currentArtifacts = artifacts.length
    ? artifacts
        .map(
          (artifact) =>
            `\`\`\`${artifact.type} filename="${artifact.filename}"\n${artifact.content}\n\`\`\``,
        )
        .join("\n\n")
    : "No current artifacts.";

  const result = await invokeModelWithRetry(model, [
    {
      role: "system",
      content: [
        "You are Builder.",
        "Update the existing product based on the follow-up prompt.",
        `Planner artifactKind: ${plan.artifactKind ?? "unspecified"}`,
        `Planner requiredSkills: ${(plan.requiredSkills ?? []).join(", ") || "none"}`,
        `Planner selectedCapabilityIds: ${(plan.selectedCapabilityIds ?? []).join(", ") || "none"}`,
        formatAgentRuntimeContext(agent),
        "Return named fenced code blocks for every changed or new file.",
        "Follow the planner artifactKind and requiredSkills. Do not re-classify the mission from keywords.",
        "Preserve existing behavior unless the follow-up asks to change it.",
        "Do not output clarification text, plans, or prose.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Original mission: ${originalMission}`,
        `Follow-up prompt: ${followUpPrompt}`,
        "",
        "Current artifacts:",
        currentArtifacts,
        "",
        "Current task plan:",
        formatTasksForPrompt(tasks),
        "",
        "Update the implementation now.",
      ].join("\n"),
    },
  ]);

  const content = extractMessageContent(result.content);
  if (extractArtifactsFromText(content).length > 0) {
    return content;
  }

  return repairOutputFormat(model, content, "The Builder agent returned no named artifact code block.");
}

async function runReviewerAgent(
  mission: string,
  tasks: MissionTask[],
  artifacts: MissionArtifact[],
  agent: AgentProfile,
  model: MissionChatModel,
): Promise<MissionReview> {
  if (artifacts.length === 0) {
    return {
      passed: false,
      issues: ["No artifact was generated."],
      requiredFixes: ["Return at least one complete named artifact code block."],
      summary: "Reviewer found no generated artifact.",
    };
  }

  const result = await invokeModelWithRetry(model, [
    {
      role: "system",
      content: [
        "You are the Reviewer agent in a MetaFlow multi-agent run.",
        agent.description,
        formatAgentRuntimeContext(agent),
        "Return only a fenced JSON block named review.json.",
        "Shape: {\"passed\": boolean, \"issues\": string[], \"requiredFixes\": string[], \"summary\": string}",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Mission: ${mission}`,
        "",
        "Tasks:",
        formatTasksForPrompt(tasks),
        "",
        "Artifacts:",
        artifacts
          .map(
            (artifact) =>
              `${artifact.filename}: ${artifact.type}, ${artifact.content.length} characters.`,
          )
          .join("\n\n"),
        "",
        "Check whether the artifacts satisfy the mission and identify only required fixes.",
      ].join("\n"),
    },
  ]);

  return parseReview(extractMessageContent(result.content));
}

async function runReviewerAgentSafely(
  mission: string,
  tasks: MissionTask[],
  artifacts: MissionArtifact[],
  agent: AgentProfile,
  model: MissionChatModel,
): Promise<MissionReview> {
  try {
    return await runReviewerAgent(mission, tasks, artifacts, agent, model);
  } catch (error) {
    if (artifacts.length > 0) {
      return {
        passed: true,
        issues: [error instanceof Error ? error.message : "Reviewer failed."],
        requiredFixes: [],
        summary: "Reviewer could not complete in time; keeping the generated artifact.",
      };
    }

    throw error;
  }
}

async function runRepairAgent(
  mission: string,
  artifacts: MissionArtifact[],
  review: MissionReview,
  agent: AgentProfile,
  model: MissionChatModel,
): Promise<string> {
  const result = await invokeModelWithRetry(model, [
    {
      role: "system",
      content: [
        "You are Builder.",
        "Repair the artifact according to reviewer feedback.",
        formatAgentRuntimeContext(agent),
        "Return exactly one complete replacement file in a named fenced code block.",
        "Implement the user's requested app directly.",
        "Do not build a requirements clarification page, task planner, proposal, or explanation page.",
        "Do not return patches or explanations.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Mission: ${mission}`,
        "",
        "Reviewer required fixes:",
        review.requiredFixes.map((fix) => `- ${fix}`).join("\n"),
        "",
        "Current artifacts:",
        artifacts
          .map((artifact) => `\`\`\`${artifact.type} filename="${artifact.filename}"\n${artifact.content}\n\`\`\``)
          .join("\n\n"),
        "",
        "Repair the artifact now.",
      ].join("\n"),
    },
  ]);

  const content = extractMessageContent(result.content);
  return content;
}

async function repairOutputFormat(
  model: MissionChatModel,
  previousOutput: string,
  reason: string,
): Promise<string> {
  const result = await invokeModelWithRetry(model, [
    {
      role: "system",
      content:
        "Repair the previous response format. Return the same artifact content in named fenced code blocks such as ```html filename=\"index.html\". Do not invent new content.",
    },
    {
      role: "user",
      content: [reason, "", "Previous output:", previousOutput].join("\n"),
    },
  ]);

  return extractMessageContent(result.content);
}

async function invokeModelWithRetry(
  model: MissionChatModel,
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  try {
    return await model.invoke(messages);
  } catch (error) {
    const retryPrompt = [
      ...messages,
      {
        role: "user" as const,
        content: [
          "The previous call failed before returning usable output.",
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          "Retry once and return the requested format.",
        ].join("\n"),
      },
    ];
    return model.invoke(retryPrompt);
  }
}

async function runWithProgressHeartbeat<T>(
  operation: () => Promise<T>,
  createUpdate: () => MissionProgressUpdate,
  onProgress?: (update: MissionProgressUpdate) => void | Promise<void>,
  intervalMs = 15_000,
): Promise<T> {
  if (!onProgress) {
    return operation();
  }

  let stopped = false;
  const emitHeartbeat = async () => {
    if (stopped) {
      return;
    }

    await onProgress(createUpdate());
  };
  const timer = setInterval(() => {
    void emitHeartbeat();
  }, intervalMs);

  try {
    return await operation();
  } finally {
    stopped = true;
    clearInterval(timer);
  }
}

function extractNamedJson(text: string, filename: string): Record<string, unknown> | null {
  const blocks = extractNamedCodeBlocks(text, filename);
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block.content) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseReview(text: string): MissionReview {
  const parsed = extractNamedJson(text, "review.json");
  if (!parsed) {
    return {
      passed: true,
      issues: ["Reviewer output was not structured JSON."],
      requiredFixes: [],
      summary: "Reviewer returned an incomplete review; keeping the generated artifact.",
    };
  }

  return {
    passed: parsed?.passed === true,
    issues: Array.isArray(parsed?.issues)
      ? parsed.issues.filter((issue): issue is string => typeof issue === "string")
      : ["Reviewer output did not include issues."],
    requiredFixes: Array.isArray(parsed?.requiredFixes)
      ? parsed.requiredFixes.filter((fix): fix is string => typeof fix === "string")
      : ["Return valid review.json or repair the artifact format."],
    summary:
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Reviewer returned an incomplete review.",
  };
}

function reviewArtifactsLocally(mission: string, artifacts: MissionArtifact[]): MissionReview {
  const issues: string[] = [];
  const requiredFixes: string[] = [];
  const combined = artifacts.map((artifact) => artifact.content).join("\n").toLowerCase();
  const missionText = mission.toLowerCase();

  if (artifacts.length === 0) {
    issues.push("No artifact was generated.");
    requiredFixes.push("Generate a complete runnable artifact.");
  }

  if (/需求澄清|任务澄清|澄清器|requirements clarification|clarification page|follow-up/i.test(combined)) {
    issues.push("Artifact is a clarification or planning page instead of the requested app.");
    requiredFixes.push("Replace it with the actual runnable app requested by the mission.");
  }

  if (
    isSoftwareMission(missionText) &&
    !/<script[\s>]/i.test(combined) &&
    !artifacts.some((artifact) => isCodeArtifact(artifact))
  ) {
    issues.push("Software artifact does not include runnable client-side behavior.");
    requiredFixes.push("Add complete JavaScript or React behavior for the app.");
  }

  const uniqueFixes = [...new Set(requiredFixes)];
  return {
    passed: issues.length === 0,
    issues,
    requiredFixes: uniqueFixes,
    summary:
      issues.length === 0
        ? "Local artifact review passed."
        : `Local artifact review found ${issues.length} issue(s).`,
  };
}

function mergeReviews(modelReview: MissionReview, localReview: MissionReview): MissionReview {
  const issues = [...modelReview.issues, ...localReview.issues].filter(Boolean);
  const requiredFixes = [
    ...modelReview.requiredFixes,
    ...localReview.requiredFixes,
  ].filter(Boolean);
  const passed = modelReview.passed && localReview.passed;

  return {
    passed,
    issues: [...new Set(issues)],
    requiredFixes: [...new Set(requiredFixes)],
    summary: passed
      ? modelReview.summary || localReview.summary
      : [modelReview.summary, localReview.summary].filter(Boolean).join(" "),
  };
}

function mergeArtifacts(existing: MissionArtifact[], incoming: MissionArtifact[]): MissionArtifact[] {
  const merged = [...existing];
  for (const artifact of incoming) {
    const index = merged.findIndex((item) => item.filename === artifact.filename);
    if (index >= 0) {
      merged[index] = artifact;
    } else {
      merged.push(artifact);
    }
  }
  return merged.map((artifact, index) => ({
    ...artifact,
    id: `artifact-${index + 1}`,
  }));
}

function isCodeArtifact(artifact: MissionArtifact): boolean {
  return ["javascript", "typescript", "react"].includes(artifact.type);
}

function isSoftwareMission(mission: string): boolean {
  return /app|web|网页|应用|小游戏|游戏|工具|software|site|website/.test(mission);
}

function formatTasksForPrompt(tasks: MissionTask[]): string {
  return (
    tasks
      .map(
        (task) =>
          `- ${task.id}: ${task.title} -> ${task.assignedTo}; status=${task.status}; ${task.description}`,
      )
      .join("\n") || "No tasks."
  );
}

function formatAgentRuntimeContext(agent: AgentProfile): string {
  const skillDetails = agent.skillDetails ?? [];
  return [
    `Agent: ${agent.name}`,
    `Description: ${agent.description}`,
    agent.instructions ? `Instructions:\n${agent.instructions}` : "",
    `Skill labels: ${agent.skills.join(", ") || "none"}`,
    skillDetails.length
      ? [
          "Installed skill references:",
          ...skillDetails.map((skill) =>
            [
              `## ${skill.name} (${skill.id})`,
              skill.description,
              skill.originUrl ? `Origin: ${skill.originUrl}` : "",
            ].join("\n"),
          ),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatReviewOutput(review: MissionReview): string {
  return [
    "```json filename=\"review.json\"",
    JSON.stringify(review, null, 2),
    "```",
  ].join("\n");
}

export function extractArtifactsFromText(text: string): MissionArtifact[] {
  const artifacts: MissionArtifact[] = [];
  const fencePattern = /```(\w+)?[^\n`]*(?:filename|file)=["']?([^"'\n`]+)["']?[^\n`]*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const language = (match[1] ?? "text").toLowerCase();
    const filename = sanitizeFilename(match[2] ?? `artifact-${artifacts.length + 1}.txt`);
    const content = (match[3] ?? "").trim();
    if (isOrchestrationFilename(filename)) {
      continue;
    }

    if (!content) {
      continue;
    }

    artifacts.push({
      id: `artifact-${artifacts.length + 1}`,
      type: artifactTypeFor(language, filename),
      filename,
      title: filename,
      description: `Generated by the live model response as ${filename}.`,
      content,
    });
  }

  return artifacts;
}

function isOrchestrationFilename(filename: string): boolean {
  return [
    "mission-run.json",
    "planner-output.json",
    "review.json",
  ].includes(filename);
}

export function extractRunReportFromText(text: string): MissionRunReport | null {
  const jsonBlocks = extractNamedCodeBlocks(text, "mission-run.json");
  for (const block of jsonBlocks) {
    const parsed = parseRunReport(block.content);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function extractNamedCodeBlocks(text: string, filename: string) {
  const blocks: Array<{ language: string; filename: string; content: string }> = [];
  const fencePattern = /```(\w+)?[^\n`]*(?:filename|file)=["']?([^"'\n`]+)["']?[^\n`]*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const blockFilename = sanitizeFilename(match[2] ?? "");
    if (blockFilename !== filename) {
      continue;
    }

    blocks.push({
      language: (match[1] ?? "text").toLowerCase(),
      filename: blockFilename,
      content: (match[3] ?? "").trim(),
    });
  }

  return blocks;
}

function parseRunReport(content: string): MissionRunReport | null {
  try {
    const value = JSON.parse(content) as Partial<MissionRunReport>;
    const tasks = Array.isArray(value.tasks)
      ? value.tasks.filter(isMissionTask)
      : undefined;
    const runLogs = Array.isArray(value.runLogs)
      ? value.runLogs.filter(isRunLog)
      : undefined;

    return {
      finalBrief: typeof value.finalBrief === "string" ? value.finalBrief : undefined,
      tasks,
      runLogs,
    };
  } catch {
    return null;
  }
}

function isMissionTask(value: unknown): value is MissionTask {
  if (!value || typeof value !== "object") {
    return false;
  }

  const task = value as Record<string, unknown>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.description === "string" &&
    typeof task.assignedTo === "string" &&
    isTaskStatus(task.status) &&
    (task.section === undefined || typeof task.section === "string") &&
    (task.feature === undefined || typeof task.feature === "string") &&
    (task.goal === undefined || typeof task.goal === "string") &&
    (task.assignedAgentId === undefined || typeof task.assignedAgentId === "string") &&
    (task.requiredSkills === undefined ||
      (Array.isArray(task.requiredSkills) &&
        task.requiredSkills.every((skill) => typeof skill === "string"))) &&
    (task.requiredSkillIds === undefined ||
      (Array.isArray(task.requiredSkillIds) &&
        task.requiredSkillIds.every((skill) => typeof skill === "string"))) &&
    (task.dependencies === undefined ||
      (Array.isArray(task.dependencies) &&
        task.dependencies.every((dependency) => typeof dependency === "string"))) &&
    (task.expectedArtifact === undefined || typeof task.expectedArtifact === "string")
  );
}

function isRunLog(value: unknown): value is MissionRunLog {
  if (!value || typeof value !== "object") {
    return false;
  }

  const log = value as Record<string, unknown>;
  return (
    typeof log.agent === "string" &&
    typeof log.taskId === "string" &&
    isLogLevel(log.level) &&
    typeof log.message === "string"
  );
}

function isTaskStatus(value: unknown): value is MissionTask["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "reviewing" ||
    value === "done"
  );
}

function isLogLevel(value: unknown): value is MissionRunLog["level"] {
  return value === "info" || value === "warning" || value === "error";
}

function extractMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String(item.text);
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }

  return content ? JSON.stringify(content) : "";
}

function extractDeepAgentOutput(result: unknown): string {
  if (!result || typeof result !== "object") {
    return typeof result === "string" ? result : "";
  }

  const value = result as Record<string, unknown>;
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const textParts = messages
    .map((message) => {
      if (!message || typeof message !== "object") {
        return "";
      }

      return extractMessageContent((message as Record<string, unknown>).content);
    })
    .filter(Boolean);

  return textParts.length > 0 ? textParts.join("\n\n") : extractMessageContent(value.content);
}

function extractArtifactsFromDeepAgentFiles(result: unknown): MissionArtifact[] {
  const files = extractDeepAgentFileRecord(result);

  const artifacts: MissionArtifact[] = [];
  for (const [rawPath, rawFile] of Object.entries(files)) {
    const filename = filenameFromDeepAgentFilePath(rawPath);
    if (!filename || isOrchestrationFilename(filename)) {
      continue;
    }

    const content = extractDeepAgentFileContent(rawFile);
    if (!content.trim()) {
      continue;
    }

    artifacts.push({
      id: `artifact-${artifacts.length + 1}`,
      type: artifactTypeFor(languageFromFilename(filename), filename),
      filename,
      title: filename,
      description: `Generated by native DeepAgents as ${filename}.`,
      content: content.trim(),
    });
  }

  return artifacts;
}

function extractDeepAgentFileRecord(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") {
    return {};
  }

  const files = (result as Record<string, unknown>).files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return {};
  }

  return files as Record<string, unknown>;
}

function extractArtifactFileRecord(result: unknown): Record<string, unknown> {
  const files = extractDeepAgentFileRecord(result);
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => path.trim().replace(/\\/g, "/").startsWith("/artifacts/")),
  );
}

function filenameFromDeepAgentFilePath(rawPath: string): string | null {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/skills/")) {
    return null;
  }

  const artifactPrefix = "/artifacts/";
  if (normalized.startsWith(artifactPrefix)) {
    return sanitizeFilename(normalized.slice(artifactPrefix.length));
  }

  const filename = sanitizeFilename(normalized.split("/").pop() ?? "");
  if (isLikelyUserArtifactFilename(filename)) {
    return filename;
  }

  return null;
}

function extractDeepAgentFileContent(rawFile: unknown): string {
  if (typeof rawFile === "string") {
    return rawFile;
  }

  if (!rawFile || typeof rawFile !== "object") {
    return "";
  }

  const content = (rawFile as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((line) => String(line)).join("\n");
  }

  return "";
}

function isLikelyUserArtifactFilename(filename: string): boolean {
  if (!filename || filename.startsWith("SKILL.")) {
    return false;
  }

  return /(^|\/)(index|app|main|styles?|deck|slides?|document|report|artifact)\.(html|jsx|tsx|js|ts|css|md|json|txt)$/i.test(
    filename,
  );
}

function languageFromFilename(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension) {
    return "text";
  }

  return extension === "md" ? "markdown" : extension;
}

function extractStreamEventOutput(event: unknown): unknown {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const value = event as Record<string, unknown>;
  if (value.event !== "on_chain_end") {
    return undefined;
  }

  const data = value.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const output = (data as Record<string, unknown>).output;
  return isDeepAgentRunResult(output) ? output : undefined;
}

function extractStreamEventFiles(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") {
    return {};
  }

  const value = event as Record<string, unknown>;
  const data = value.data;
  if (!data || typeof data !== "object") {
    return {};
  }

  const record = data as Record<string, unknown>;
  const filesFromOutput = extractFilesFromUnknown(record.output);
  if (Object.keys(filesFromOutput).length > 0) {
    return filesFromOutput;
  }

  if (value.event === "on_tool_end" && value.name === "submit_artifact") {
    return extractFilesFromSubmitArtifactOutput(record.output);
  }

  return {};
}

function extractStreamText(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }

  const value = event as Record<string, unknown>;
  const data = value.data;
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
  return [record.input, record.output]
    .map((item) => extractMessageContent(item))
    .filter(Boolean)
    .join("\n");
}

function extractFilesFromSubmitArtifactOutput(output: unknown): Record<string, unknown> {
  const parsed = parseUnknownJsonObject(output);
  if (!parsed) {
    return {};
  }

  return extractFilesFromUnknown(parsed);
}

function parseUnknownJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractFilesFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const files = record.files;
  if (files && typeof files === "object" && !Array.isArray(files)) {
    return files as Record<string, unknown>;
  }

  const update = record.update;
  if (update && typeof update === "object") {
    return extractFilesFromUnknown(update);
  }

  return {};
}

function mergeDeepAgentRunResult(result: unknown, files: Record<string, unknown>): unknown {
  if (Object.keys(files).length === 0) {
    return result;
  }

  if (!result || typeof result !== "object") {
    return { messages: [], files };
  }

  const record = result as Record<string, unknown>;
  const existingFiles =
    record.files && typeof record.files === "object" && !Array.isArray(record.files)
      ? (record.files as Record<string, unknown>)
      : {};

  return {
    ...record,
    files: {
      ...existingFiles,
      ...files,
    },
  };
}

function isDeepAgentRunResult(output: unknown): output is Record<string, unknown> {
  return (
    !!output &&
    typeof output === "object" &&
    ("messages" in output || "files" in output)
  );
}

function formatDeepAgentStreamEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const value = event as Record<string, unknown>;
  const eventName = typeof value.event === "string" ? value.event : "";
  const runnableName = typeof value.name === "string" ? value.name : "tool";
  const data = value.data && typeof value.data === "object"
    ? (value.data as Record<string, unknown>)
    : {};

  if (eventName === "on_tool_start" && runnableName === "write_todos") {
    const todos = extractTodoLabels(data.input);
    return todos.length > 0
      ? `DeepAgents updated todos: ${todos.join("; ")}`
      : "DeepAgents updated todos.";
  }

  if (eventName === "on_tool_start" && runnableName === "task") {
    const input = data.input && typeof data.input === "object"
      ? (data.input as Record<string, unknown>)
      : {};
    const agent =
      typeof input.subagent_type === "string" && input.subagent_type.trim()
        ? input.subagent_type.trim()
        : "subagent";
    const description =
      typeof input.description === "string" && input.description.trim()
        ? input.description.trim()
        : summarizeUnknown(input);
    return `DeepAgents delegated task to ${agent}: ${description}`;
  }

  if (eventName === "on_tool_end" && runnableName === "task") {
    return `DeepAgents completed task: ${summarizeUnknown(data.output)}`;
  }

  if (eventName === "on_tool_end" && runnableName === "submit_artifact") {
    const files = extractFilesFromSubmitArtifactOutput(data.output);
    const filenames = Object.keys(files)
      .map((path) => filenameFromDeepAgentFilePath(path))
      .filter((filename): filename is string => !!filename);
    return filenames.length > 0
      ? `DeepAgents submitted artifact: ${filenames.join(", ")}`
      : "DeepAgents submitted artifact.";
  }

  if (eventName === "on_tool_start") {
    return `DeepAgents started tool ${runnableName}.`;
  }

  if (eventName === "on_tool_end") {
    return `DeepAgents completed tool ${runnableName}.`;
  }

  return null;
}

function streamEventType(message: string): MissionEvent["type"] {
  if (message.includes("delegated task") || message.includes("started tool")) {
    return "task.started";
  }
  if (message.includes("submitted artifact")) {
    return "task.reviewed";
  }
  if (message.includes("completed task") || message.includes("completed tool")) {
    return "task.reviewed";
  }
  return "task.assigned";
}

function extractTodoLabels(input: unknown): string[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) {
    return [];
  }

  return todos
    .map((todo) => {
      if (typeof todo === "string") {
        return todo.trim();
      }
      if (todo && typeof todo === "object") {
        const record = todo as Record<string, unknown>;
        return typeof record.content === "string"
          ? record.content.trim()
          : typeof record.task === "string"
            ? record.task.trim()
            : "";
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 5);
}

function summarizeUnknown(value: unknown): string {
  const text = extractMessageContent(value).replace(/\s+/g, " ").trim();
  if (!text) {
    return "completed.";
  }
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function isDeepAgentCompatibleModel(model: MissionDeepAgentModel): model is BaseLanguageModel {
  const candidate = model as Record<string, unknown>;
  return (
    typeof candidate.bindTools === "function" ||
    typeof candidate.withConfig === "function"
  );
}

function createMetaAgentTools(registry: Capability[]) {
  const searchCapabilities = tool(
    ({ query }) =>
      JSON.stringify(
        selectCapabilities(query, registry).map((capability) => ({
          id: capability.id,
          name: capability.name,
          description: capability.description,
        })),
      ),
    {
      name: "search_capabilities",
      description: "Search reusable agents, tools, workflows, and templates before creating anything new.",
      schema: z.object({
        query: z.string().describe("The mission or task need to match against known capabilities."),
      }),
    },
  );

  const createEphemeral = tool(
    ({ mission }) => JSON.stringify(createEphemeralAgent(mission)),
    {
      name: "create_ephemeral_agent",
      description: "Create one scoped temporary agent only when existing capabilities do not cover the need.",
      schema: z.object({
        mission: z.string().describe("The uncovered mission need."),
      }),
    },
  );

  const assignTask = tool(
    ({ task, agent }) =>
      JSON.stringify({
        task,
        agent,
        status: "assigned",
      }),
    {
      name: "assign_task",
      description: "Assign a clear task to an existing or temporary agent.",
      schema: z.object({
        task: z.string().describe("The task to assign."),
        agent: z.string().describe("The target agent or capability name."),
      }),
    },
  );

  return [searchCapabilities, createEphemeral, assignTask, createSubmitArtifactTool()];
}

function createSubmitArtifactTool() {
  return tool(
    ({ filename, content }) =>
      JSON.stringify({
        files: {
          [`/artifacts/${sanitizeFilename(filename)}`]: createDeepAgentTextFile(content),
        },
      }),
    {
      name: "submit_artifact",
      description:
        "Submit a complete final user-facing artifact. Use this before finishing any mission that produces an app, document, deck, report, script, or other deliverable.",
      schema: z.object({
        filename: z.string().describe("Final artifact filename such as index.html, src/App.jsx, deck.md, report.md, or script.js."),
        content: z.string().describe("Complete artifact content. Do not pass a summary or placeholder."),
      }),
    },
  );
}

function selectCapabilities(mission: string, registry: Capability[]): Capability[] {
  const tokens = tokenize(mission);
  const scored = registry
    .map((capability) => ({
      capability,
      score: capability.tags.filter((tag) => tokens.has(tag)).length,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected = scored.slice(0, 3).map((item) => item.capability);
  const hasReusableSignal = [...tokens].some((token) => reusableNeedTags.has(token));

  if (selected.length > 0 || !hasReusableSignal) {
    return selected;
  }

  return registry.filter((capability) =>
    ["critical-review", "report-writer"].includes(capability.id),
  );
}

function createEphemeralAgent(mission: string): AgentProfile {
  return {
    id: "agent-context-specialist",
    name: "Context specialist",
    description: "A temporary specialist created by Meta Agent for mission-specific context.",
    skills: ["domain framing", "structured synthesis", "launch reasoning"],
    taskScope: `Handle the mission-specific parts that are not covered by reusable capabilities: ${mission}`,
    successCriteria: [
      "Stay inside the assigned mission scope.",
      "Produce concrete findings or recommendations.",
      "Make assumptions explicit for Meta Agent review.",
    ],
    temporary: true,
    createdBy: "meta-agent",
  };
}

function createTasks(mission: string, actors: string[]): MissionTask[] {
  const activeActors = actors.length > 0 ? actors : ["Meta Agent"];

  return activeActors.map((actor, index) => ({
    id: `task-${index + 1}`,
    title: index === 0 ? "Understand and gather context" : `Contribute with ${actor}`,
    description:
      index === 0
        ? `Clarify the mission and gather the most useful existing information for: ${mission}`
        : `Use ${actor} to cover its part of the mission and produce a reviewable artifact.`,
    assignedTo: actor,
    status: index === activeActors.length - 1 ? "reviewing" : "running",
  }));
}

function createExecutionTasks(mission: string): MissionTask[] {
  return [
    {
      id: "task-1",
      title: "Shape the product",
      description: `Clarify the core user outcome and feature shape for: ${mission}`,
      assignedTo: "Product Planner",
      assignedAgentId: "planner",
      requiredSkills: ["mission analysis", "product planning"],
      expectedArtifact: "concise implementation direction",
      status: "queued",
    },
    {
      id: "task-2",
      title: "Build artifact",
      description: `Implement the requested artifact directly for: ${mission}`,
      assignedTo: "Builder",
      assignedAgentId: "builder",
      requiredSkills: ["artifact generation", "software implementation"],
      dependencies: ["task-1"],
      expectedArtifact: "runnable user artifact",
      status: "queued",
    },
    {
      id: "task-3",
      title: "Review artifact",
      description: "Check whether the artifact satisfies the original mission and request focused repairs if needed.",
      assignedTo: "Reviewer",
      assignedAgentId: "reviewer",
      requiredSkills: ["quality review", "requirements checking"],
      dependencies: ["task-2"],
      expectedArtifact: "acceptance review",
      status: "queued",
    },
  ];
}

function createDynamicExecutionTasks(
  tasks: MissionTask[],
  mission: string,
  agents: AgentProfile[],
): MissionTask[] {
  const sourceTasks =
    tasks.length > 0 && !isCoarseTaskPlan(tasks, mission)
      ? tasks
      : createExecutionTasks(mission);
  const normalized = sourceTasks.map((task, index) =>
    normalizePlannedTask(task, index, agents),
  );

  const hasArtifactTask = normalized.some((task) => isArtifactTask(task));
  const hasReviewTask = normalized.some((task) => isReviewTask(task));
  const nextTasks = [...normalized];

  if (!hasArtifactTask) {
    nextTasks.push({
      id: `task-${nextTasks.length + 1}`,
      title: "Build artifact",
      description: `Implement the requested artifact directly for: ${mission}`,
      assignedTo: "Builder",
      assignedAgentId: "builder",
      requiredSkills: ["artifact generation"],
      dependencies: nextTasks.length ? [nextTasks[nextTasks.length - 1]!.id] : [],
      expectedArtifact: "runnable user artifact",
      status: "queued",
    });
  }

  if (!hasReviewTask) {
    nextTasks.push({
      id: `task-${nextTasks.length + 1}`,
      title: "Review artifact",
      description: "Check whether the final artifact satisfies the mission.",
      assignedTo: "Reviewer",
      assignedAgentId: "reviewer",
      requiredSkills: ["quality review"],
      dependencies: [selectArtifactTask(nextTasks).id],
      expectedArtifact: "acceptance review",
      status: "queued",
    });
  }

  return nextTasks;
}

function normalizePlannedTask(
  task: MissionTask,
  index: number,
  agents: AgentProfile[],
): MissionTask {
  const assignedAgent = resolveAssignedAgent(task, agents);
  return {
    ...task,
    id: task.id.trim() || `task-${index + 1}`,
    assignedTo: task.assignedTo.trim() || assignedAgent.name,
    assignedAgentId: task.assignedAgentId || assignedAgent.id,
    section: task.section?.trim() || inferTaskSection(task),
    feature: task.feature?.trim() || inferTaskFeature(task),
    requiredSkills: task.requiredSkills?.filter(Boolean) ?? assignedAgent.skills.slice(0, 3),
    requiredSkillIds:
      task.requiredSkillIds?.filter(Boolean) ??
      assignedAgent.skillIds?.slice(0, 3) ??
      assignedAgent.skillDetails?.map((skill) => skill.id).slice(0, 3),
    dependencies: task.dependencies?.filter(Boolean) ?? [],
    expectedArtifact: task.expectedArtifact,
    status: "queued",
  };
}

function isCoarseTaskPlan(tasks: MissionTask[], mission: string): boolean {
  const uniqueAssignedAgents = new Set(tasks.map((task) => task.assignedTo.toLowerCase()));
  const genericTasks = tasks.filter((task) => isGenericPlannedTask(task)).length;
  return (
    tasks.length <= 3 &&
    uniqueAssignedAgents.size <= 2 &&
    genericTasks > 0 &&
    genericTasks >= tasks.length - 1
  );
}

function isGenericPlannedTask(task: MissionTask): boolean {
  return /^(build artifact|review artifact|generate app|build app|review app)$/i.test(
    task.title.trim(),
  );
}

function inferTaskSection(task: MissionTask): string | undefined {
  if (isReviewTask(task)) return "Quality";
  if (task.assignedAgentId === "planner") return "Planning";
  if (isArtifactTask(task)) return "Artifact";
  return undefined;
}

function inferTaskFeature(task: MissionTask): string | undefined {
  if (isReviewTask(task)) return "Acceptance check";
  if (task.assignedAgentId === "planner") return "Mission shape";
  if (isArtifactTask(task)) return "Main deliverable";
  return undefined;
}

function resolveAssignedAgent(task: MissionTask, agents: AgentProfile[]): AgentProfile {
  const assigned = task.assignedTo.toLowerCase();
  return (
    agents.find((agent) => agent.id === task.assignedAgentId) ??
    agents.find((agent) => agent.name.toLowerCase() === assigned) ??
    agents.find((agent) => assigned.includes(agent.id) || assigned.includes(agent.name.toLowerCase())) ??
    findAgent(agents, isReviewTask(task) ? "reviewer" : isArtifactTask(task) ? "builder" : "planner")
  );
}

function setTaskStatuses(
  tasks: MissionTask[],
  statuses: Partial<Record<"planner" | "builder" | "reviewer", MissionTask["status"]>>,
): MissionTask[] {
  return tasks.map((task) => {
    const key = task.assignedTo.toLowerCase();
    if (key.includes("planner")) {
      return { ...task, status: statuses.planner ?? task.status };
    }
    if (key.includes("builder") || key.includes("app builder")) {
      return { ...task, status: statuses.builder ?? task.status };
    }
    if (key.includes("reviewer")) {
      return { ...task, status: statuses.reviewer ?? task.status };
    }
    return task;
  });
}

function countAssignedAgents(tasks: MissionTask[]): number {
  return new Set(tasks.map((task) => task.assignedTo)).size;
}

function appendTaskAssignmentEvents(
  events: MissionEvent[],
  tasks: MissionTask[],
): MissionEvent[] {
  return tasks.reduce(
    (nextEvents, task) =>
      appendUniqueRuntimeEvent(
        nextEvents,
        "task.assigned",
        `${task.title} -> ${task.assignedTo}`,
      ),
    events,
  );
}

function selectArtifactTask(tasks: MissionTask[]): MissionTask {
  return (
    tasks.find((task) => task.assignedAgentId === "builder") ??
    tasks.find((task) => isImplementationTask(task)) ??
    tasks.find((task) => isArtifactTask(task)) ??
    tasks.find((task) => !isReviewTask(task)) ??
    tasks[0] ??
    createExecutionTasks("the mission")[1]!
  );
}

function selectReviewTask(tasks: MissionTask[]): MissionTask {
  return (
    tasks.find((task) => isReviewTask(task)) ??
    tasks[tasks.length - 1] ??
    createExecutionTasks("the mission")[2]!
  );
}

function selectImplementationTaskIds(tasks: MissionTask[], fallbackId: string): string[] {
  const ids = tasks
    .filter((task) => isImplementationTask(task))
    .map((task) => task.id);

  return ids.length > 0 ? ids : [fallbackId];
}

function isImplementationTask(task: MissionTask): boolean {
  if (isReviewTask(task)) {
    return false;
  }
  if (task.assignedAgentId === "planner") {
    return false;
  }

  const text = taskText(task);
  return /builder|build|implement|code|app|web|react|html|software|localstorage|state|form|interface|interaction|render|delete|edit|create|move|assign|persist|生成|实现|构建|应用|网页|删除|编辑|新增|保存/.test(
    text,
  );
}

function isArtifactTask(task: MissionTask): boolean {
  const text = taskText(task);
  return /builder|build|implement|artifact|code|app|web|react|html|software|生成|实现|构建|应用|网页|产物/.test(
    text,
  );
}

function isReviewTask(task: MissionTask): boolean {
  return /review|qa|test|verify|quality|检查|测试|验证|审核/.test(taskText(task));
}

function taskText(task: MissionTask): string {
  return [
    task.id,
    task.title,
    task.description,
    task.assignedTo,
    task.assignedAgentId,
    task.expectedArtifact,
    ...(task.requiredSkills ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function markTaskRunning(tasks: MissionTask[], taskId: string): MissionTask[] {
  return markTasksRunning(tasks, [taskId]);
}

function markTaskDone(tasks: MissionTask[], taskId: string): MissionTask[] {
  return markTasksDone(tasks, [taskId]);
}

function markTasksRunning(tasks: MissionTask[], taskIds: string[]): MissionTask[] {
  const activeIds = new Set(taskIds);
  return tasks.map((task) => ({
    ...task,
    status: activeIds.has(task.id)
      ? "running"
      : task.status === "running"
        ? "queued"
        : task.status,
  }));
}

function markTasksDone(tasks: MissionTask[], taskIds: string[]): MissionTask[] {
  const doneIds = new Set(taskIds);
  return tasks.map((task) => ({
    ...task,
    status: doneIds.has(task.id) ? "done" : task.status,
  }));
}

function markTaskReviewing(tasks: MissionTask[], taskId: string): MissionTask[] {
  return tasks.map((task) => ({
    ...task,
    status: task.id === taskId ? "reviewing" : task.status,
  }));
}

function completeAllTasks(tasks: MissionTask[]): MissionTask[] {
  return tasks.map((task) => ({ ...task, status: "done" }));
}

function createEvents(
  mission: string,
  capabilities: Capability[],
  agents: AgentProfile[],
  tasks: MissionTask[],
): MissionEvent[] {
  let index = 1;
  const nextId = () => `event-${index++}`;

  return [
    {
      id: nextId(),
      type: "mission.created",
      message: `Mission received: ${mission}`,
    },
    ...capabilities.map((capability) => ({
      id: nextId(),
      type: "capability.selected" as const,
      message: `Reusing ${capability.name}.`,
    })),
    ...agents.map((agent) => ({
      id: nextId(),
      type: "agent.created" as const,
      message: `Created temporary agent: ${agent.name}.`,
    })),
    ...tasks.map((task) => ({
      id: nextId(),
      type: "task.assigned" as const,
      message: `${task.title} -> ${task.assignedTo}`,
    })),
    {
      id: nextId(),
      type: "mission.ready",
      message: "Meta Agent is ready to monitor work, review artifacts, and synthesize the result.",
    },
  ];
}

function findAgent(agents: AgentProfile[], id: string): AgentProfile {
  const agent = agents.find((item) => item.id === id);
  if (agent) {
    return agent;
  }

  return createDefaultAgentProfiles().find((item) => item.id === id) ?? createEphemeralAgent(id);
}

function tokenize(input: string): Set<string> {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const synonyms: Record<string, string[]> = {
    competitors: ["competitor", "compare", "market", "research"],
    competitive: ["competitor", "compare", "market"],
    positioning: ["positioning", "report", "write"],
    memo: ["memo", "report", "write"],
    research: ["research", "search"],
    latest: ["latest", "search"],
    compare: ["compare", "analysis"],
    comparison: ["compare", "analysis"],
    code: ["code", "software", "build"],
    app: ["software", "build"],
    web: ["web", "software", "build"],
    ppt: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    pptx: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    powerpoint: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    presentation: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    presentations: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    slides: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    deck: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    todo: ["todo", "todolist", "software", "build", "app"],
    todolist: ["todo", "todolist", "software", "build", "app"],
    product: ["plan", "analysis"],
    生成: ["code", "software", "build"],
    创建: ["code", "software", "build"],
    网页: ["web", "software", "build"],
    应用: ["app", "software", "build"],
    路演: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    融资: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    演示: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
    幻灯片: ["ppt", "pptx", "powerpoint", "presentation", "slides", "deck"],
  };

  const tokens = new Set(normalized);
  for (const word of normalized) {
    for (const synonym of synonyms[word] ?? []) {
      tokens.add(synonym);
    }
  }

  const compactInput = normalized.join("");
  for (const [phrase, phraseSynonyms] of Object.entries(synonyms)) {
    if (compactInput.includes(phrase)) {
      tokens.add(phrase);
      for (const synonym of phraseSynonyms) {
        tokens.add(synonym);
      }
    }
  }

  return tokens;
}

function artifactTypeFor(language: string, filename: string): MissionArtifact["type"] {
  if (language === "html" || filename.endsWith(".html")) {
    return "html";
  }

  if (
    language === "jsx" ||
    language === "tsx" ||
    filename.endsWith(".jsx") ||
    filename.endsWith(".tsx")
  ) {
    return "react";
  }

  if (
    language === "javascript" ||
    language === "js" ||
    filename.endsWith(".js") ||
    filename.endsWith(".mjs")
  ) {
    return "javascript";
  }

  if (
    language === "typescript" ||
    language === "ts" ||
    filename.endsWith(".ts")
  ) {
    return "typescript";
  }

  if (language === "css" || filename.endsWith(".css")) {
    return "css";
  }

  if (language === "json" || filename.endsWith(".json")) {
    return "json";
  }

  if (language === "markdown" || language === "md" || filename.endsWith(".md")) {
    return "markdown";
  }

  return "text";
}

function sanitizeFilename(value: string): string {
  const filename = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
  return filename || "artifact.txt";
}
