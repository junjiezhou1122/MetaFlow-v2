import { describe, expect, it, vi } from "vitest";

vi.mock("deepagents", () => ({
  createDeepAgent: ({
    model,
    tools,
  }: {
    model: { invoke(input: unknown): Promise<unknown> };
    tools?: Array<{ name?: string }>;
  }) => ({
    __toolNames: tools?.map((tool) => tool.name),
    invoke: (input: unknown) => model.invoke(input),
    streamEvents:
      "streamEvents" in model
        ? (input: unknown, options: unknown) =>
            (
              model as {
                streamEvents(input: unknown, options: unknown): AsyncIterable<unknown>;
              }
            ).streamEvents(input, options)
        : undefined,
  }),
}));

import {
  buildMissionPreview,
  createDefaultCapabilityRegistry,
  createDefaultAgentProfiles,
  createMetaAgentDefinition,
  __missionRuntimeTestUtils,
  extractArtifactsFromText,
  extractRunReportFromText,
  runMultiAgentMission,
  runMissionIteration,
  runMission,
} from "./mission-runtime";

describe("mission runtime", () => {
  it("prefers existing capabilities before creating temporary agents", () => {
    const registry = createDefaultCapabilityRegistry();
    const preview = buildMissionPreview(
      "Research AI coding agent competitors and write a positioning memo.",
      registry,
    );

    expect(preview.selectedCapabilities.map((item) => item.id)).toContain("web-research");
    expect(preview.selectedCapabilities.map((item) => item.id)).toContain("report-writer");
    expect(preview.ephemeralAgents).toHaveLength(0);
    expect(preview.events[0]?.type).toBe("mission.created");
  });

  it("creates scoped ephemeral agents when no reusable capability covers a mission need", () => {
    const registry = createDefaultCapabilityRegistry();
    const preview = buildMissionPreview(
      "Design a plan for launching a boutique tea subscription in Shenzhen with sourcing, brand story, and launch channels.",
      registry,
    );

    expect(preview.ephemeralAgents.length).toBeGreaterThan(0);
    expect(preview.ephemeralAgents[0]).toMatchObject({
      temporary: true,
      createdBy: "meta-agent",
    });
    expect(preview.ephemeralAgents[0]?.taskScope.length).toBeGreaterThan(20);
    expect(preview.events.some((event) => event.type === "agent.created")).toBe(true);
  });

  it("defines the meta agent as a DeepAgents orchestrator with dynamic delegation tools", () => {
    const metaAgent = createMetaAgentDefinition(createDefaultCapabilityRegistry());

    expect(metaAgent.name).toBe("meta-agent");
    expect(metaAgent.subagents.map((agent) => agent.name)).toContain("researcher");
    expect(metaAgent.subagents.find((agent) => agent.name === "builder")?.skills).toEqual([
      "/skills/",
    ]);
    expect(metaAgent.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search_capabilities",
        "create_ephemeral_agent",
        "assign_task",
        "submit_artifact",
      ]),
    );
  });

  it("uses an artifact-only DeepAgents handoff agent for closure", () => {
    const handoff = __missionRuntimeTestUtils.createArtifactHandoffDeepAgent({
      invoke: async () => ({}),
    } as never) as unknown as { __toolNames?: string[] };

    expect(handoff.__toolNames).toEqual(["submit_artifact"]);
    expect(handoff.__toolNames).not.toContain("assign_task");
    expect(handoff.__toolNames).not.toContain("search_capabilities");
    expect(handoff.__toolNames).not.toContain("create_ephemeral_agent");
  });

  it("keeps artifact handoff input free of skill documents", () => {
    const input = __missionRuntimeTestUtils.createNativeArtifactClosureInput(
      "生成一个网页应用",
      {
        "/skills/noisy/SKILL.md": {
          path: "/skills/noisy/SKILL.md",
          content: "large irrelevant skill document",
          mimeType: "text/markdown",
          created_at: "2026-05-12T00:00:00.000Z",
          modified_at: "2026-05-12T00:00:00.000Z",
        },
      },
      {
        files: {
          "/skills/waapi/SKILL.md": {
            content: "irrelevant waapi document",
          },
          "/artifacts/draft.html": {
            content: "<!doctype html><html><body>Draft</body></html>",
          },
        },
      },
      "previous output",
    );

    expect(Object.keys(input.files)).toEqual(["/artifacts/draft.html"]);
  });

  it("materializes agent skills as DeepAgents SKILL.md files", () => {
    const files = __missionRuntimeTestUtils.createDeepAgentSkillFiles(
      createDefaultAgentProfiles(),
    );
    const builderSkill = files["/skills/system-artifact-generation/SKILL.md"];

    expect(builderSkill?.content).toContain("name: system-artifact-generation");
    expect(builderSkill?.content).toContain("Artifact Generation");
    expect(builderSkill?.mimeType).toBe("text/markdown");
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "/skills/system-mission-planning/SKILL.md",
        "/skills/system-artifact-generation/SKILL.md",
        "/skills/system-artifact-review/SKILL.md",
      ]),
    );
  });

  it("routes Chinese web app missions to implementation capabilities", () => {
    const preview = buildMissionPreview(
      "生成一个 todolist web 应用",
      createDefaultCapabilityRegistry(),
    );

    expect(preview.selectedCapabilities.map((item) => item.id)).toContain(
      "app-builder",
    );
    expect(preview.ephemeralAgents).toHaveLength(0);
  });

  it("routes Chinese score app missions to implementation capabilities", () => {
    const preview = buildMissionPreview(
      "我现在要做一个比赛积分的应用，队伍名称和分数，好看一点",
      createDefaultCapabilityRegistry(),
    );

    expect(preview.selectedCapabilities.map((item) => item.id)).toContain(
      "app-builder",
    );
    expect(preview.ephemeralAgents).toHaveLength(0);
  });

  it("searches reusable capabilities without assigning a fake intent in preview mode", () => {
    const preview = buildMissionPreview(
      "帮我做一个融资路演 PPT",
      createDefaultCapabilityRegistry(),
    );

    expect(preview.artifactKind).toBeUndefined();
    expect(preview.requiredSkills).toBeUndefined();
    expect(preview.selectedCapabilities.map((item) => item.id)).toContain(
      "presentation-builder",
    );
    expect(
      preview.selectedCapabilities.find((item) => item.id === "presentation-builder"),
    ).toMatchObject({
      skillName: "presentations",
      artifactKinds: ["slide_deck", "pptx"],
    });
  });

  it("does not fabricate artifacts without a live model", async () => {
    const preview = await runMission("生成一个 todolist web 应用");

    expect(preview.mode).toBe("preview");
    expect(preview.artifacts).toEqual([]);
    expect(preview.finalOutput).toBeUndefined();
  });

  it("extracts runnable artifacts from live model text", () => {
    const artifacts = extractArtifactsFromText(
      [
        "Here is the generated app.",
        "```html filename=\"todolist.html\"",
        "<!doctype html>",
        "<html><body><h1>Todo</h1><script>localStorage.setItem('x','y')</script></body></html>",
        "```",
      ].join("\n"),
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: "html",
      filename: "todolist.html",
    });
    expect(artifacts[0]?.content).toContain("<!doctype html>");
    expect(artifacts[0]?.content).toContain("localStorage");
  });

  it("extracts React project files without flattening paths", () => {
    const artifacts = extractArtifactsFromText(
      [
        "```jsx filename=\"src/App.jsx\"",
        "export default function App(){ return <button>Save</button> }",
        "```",
        "```css filename=\"src/styles.css\"",
        "button { color: red; }",
        "```",
      ].join("\n"),
    );

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      type: "react",
      filename: "src/App.jsx",
    });
    expect(artifacts[1]).toMatchObject({
      type: "css",
      filename: "src/styles.css",
    });
  });

  it("does not expose orchestration JSON blocks as user artifacts", () => {
    const artifacts = extractArtifactsFromText(
      [
        "```json filename=\"planner-output.json\"",
        JSON.stringify({ tasks: [] }),
        "```",
        "```json filename=\"review.json\"",
        JSON.stringify({ passed: true }),
        "```",
        "```html filename=\"index.html\"",
        "<!doctype html><html><body>Todo</body></html>",
        "```",
      ].join("\n"),
    );

    expect(artifacts.map((artifact) => artifact.filename)).toEqual(["index.html"]);
  });

  it("extracts structured mission run reports from live model text", () => {
    const report = extractRunReportFromText(
      [
        "```json filename=\"mission-run.json\"",
        JSON.stringify({
          finalBrief: "Built and reviewed the app.",
          tasks: [
            {
              id: "task-1",
              title: "Build app",
              description: "Create the runnable HTML file.",
              assignedTo: "App builder",
              status: "done",
            },
          ],
          runLogs: [
            {
              agent: "App builder",
              taskId: "task-1",
              level: "info",
              message: "Generated index.html.",
            },
          ],
        }),
        "```",
      ].join("\n"),
    );

    expect(report?.finalBrief).toBe("Built and reviewed the app.");
    expect(report?.tasks).toHaveLength(1);
    expect(report?.runLogs?.[0]).toMatchObject({
      agent: "App builder",
      message: "Generated index.html.",
    });
  });

  it("can run a direct generation model and merge real artifacts into the mission", async () => {
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Reviewer agent")) {
          return {
            content: [
              "```json filename=\"review.json\"",
              JSON.stringify({
                passed: true,
                issues: [],
                requiredFixes: [],
                summary: "Reviewer accepted the generated app.",
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Planner assigned the app build.",
                tasks: [
                  {
                    id: "task-1",
                    title: "Generate app",
                    description: "Create index.html.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
                artifactKind: "web_app",
                requiredSkills: ["software implementation"],
                selectedCapabilityIds: ["app-builder"],
              }),
              "```",
            ].join("\n"),
          };
        }

        return {
          content: [
            "```html filename=\"index.html\"",
            "<!doctype html><html><body><script>localStorage.setItem('todo','[]')</script></body></html>",
            "```",
          ].join("\n"),
        };
      },
    };

    const preview = await runMission(
      "生成一个 todolist web 应用",
      undefined,
      model as never,
    );

    expect(preview.mode).toBe("deepagents");
    expect(preview.tasks[0]?.status).toBe("done");
    expect(preview.runLogs?.map((log) => log.agent)).toEqual(
      expect.arrayContaining(["Planner", "Builder", "Reviewer"]),
    );
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
  });

  it("preserves meta-planned dynamic tasks instead of forcing a fixed board", async () => {
    const progressTasks: string[][] = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Meta Agent split the scoreboard mission across product, UI, build, and QA.",
                artifactKind: "web_app",
                requiredSkills: ["product planning", "interface design", "software implementation"],
                selectedCapabilityIds: ["app-builder"],
                tasks: [
                  {
                    id: "product-shape",
                    title: "Define score workflow",
                    description: "Decide the team name and score interactions.",
                    assignedTo: "Product Planner",
                    assignedAgentId: "planner",
                    requiredSkills: ["product planning"],
                    dependencies: [],
                    expectedArtifact: "feature shape",
                    status: "queued",
                  },
                  {
                    id: "visual-system",
                    title: "Design scoreboard UI",
                    description: "Create a clean competition scoreboard look.",
                    assignedTo: "Interface Designer",
                    assignedAgentId: "designer",
                    requiredSkills: ["interface design"],
                    dependencies: ["product-shape"],
                    expectedArtifact: "visual direction",
                    status: "queued",
                  },
                  {
                    id: "scoreboard-build",
                    title: "Build scoreboard app",
                    description: "Implement team names, scoring, and persistence.",
                    assignedTo: "App Builder",
                    assignedAgentId: "builder",
                    requiredSkills: ["software implementation"],
                    dependencies: ["visual-system"],
                    expectedArtifact: "index.html",
                    status: "queued",
                  },
                  {
                    id: "scoreboard-qa",
                    title: "Check scoring flow",
                    description: "Verify the score controls and saved state.",
                    assignedTo: "QA Reviewer",
                    assignedAgentId: "reviewer",
                    requiredSkills: ["quality review"],
                    dependencies: ["scoreboard-build"],
                    expectedArtifact: "review",
                    status: "queued",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><main><input placeholder=\"队伍\"><button>+1</button><script>localStorage.setItem('scores','[]')</script></main></body></html>\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"Scoreboard accepted.\"}\n```",
        };
      },
    };

    const preview = await runMultiAgentMission(
      "做一个比赛积分应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        progressTasks.push(update.preview.tasks.map((task) => `${task.id}:${task.status}`));
      },
    );

    expect(preview.tasks.map((task) => task.id)).toEqual([
      "product-shape",
      "visual-system",
      "scoreboard-build",
      "scoreboard-qa",
    ]);
    expect(preview.tasks.map((task) => task.assignedTo)).toEqual([
      "Product Planner",
      "Interface Designer",
      "App Builder",
      "QA Reviewer",
    ]);
    expect(progressTasks.some((tasks) => tasks.includes("scoreboard-build:running"))).toBe(true);
    expect(progressTasks.some((tasks) => tasks.includes("scoreboard-qa:reviewing"))).toBe(true);
    expect(preview.events.some((event) => event.message.includes("Interface Designer"))).toBe(true);
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
  });

  it("uses planner tasks when native DeepAgents falls back to direct building", async () => {
    const progressEvents: string[] = [];
    const model = {
      withConfig: () => model,
      invoke: async (input: unknown) => {
        const prompt = Array.isArray(input)
          ? input.map((message) => String(message.content ?? "")).join("\n")
          : JSON.stringify(input);

        if (prompt.includes("Execute this mission end to end.")) {
          return {
            messages: [
              {
                content:
                  "I inspected skills and planned the mission, but I am returning no named artifact block.",
              },
            ],
          };
        }

        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Planned a learning-agent app with mission-specific features.",
                artifactKind: "web_app",
                requiredSkills: ["agent education", "software implementation"],
                selectedCapabilityIds: ["app-builder"],
                tasks: [
                  {
                    id: "agent-concepts",
                    section: "Learning",
                    feature: "Agent concepts",
                    title: "Teach agent basics",
                    description: "Create a guided explanation of agent profiles, tools, and skills.",
                    assignedTo: "Product Planner",
                    assignedAgentId: "planner",
                    requiredSkills: ["agent education"],
                    dependencies: [],
                    expectedArtifact: "learning outline",
                    status: "queued",
                  },
                  {
                    id: "practice-lab",
                    section: "Practice",
                    feature: "Interactive lab",
                    title: "Build agent practice lab",
                    description: "Implement an interactive exercise area for creating a sample agent.",
                    assignedTo: "App Builder",
                    assignedAgentId: "builder",
                    requiredSkills: ["software implementation"],
                    dependencies: ["agent-concepts"],
                    expectedArtifact: "index.html",
                    status: "queued",
                  },
                  {
                    id: "learning-review",
                    section: "Quality",
                    feature: "Acceptance check",
                    title: "Review learning flow",
                    description: "Check that the app teaches agent concepts instead of todo management.",
                    assignedTo: "QA Reviewer",
                    assignedAgentId: "reviewer",
                    requiredSkills: ["quality review"],
                    dependencies: ["practice-lab"],
                    expectedArtifact: "review",
                    status: "queued",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><main><h1>学习 Agent</h1><section>Agent profile, tools, skills</section><button>创建练习 Agent</button><script>localStorage.setItem('agent-lab','ready')</script></main></body></html>\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"Learning-agent app accepted.\"}\n```",
        };
      },
    };

    const preview = await runMultiAgentMission(
      "做一个学习agent的应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        progressEvents.push(update.preview.events.at(-1)?.message ?? "");
      },
    );

    expect(preview.tasks.map((task) => task.id)).toEqual([
      "agent-concepts",
      "practice-lab",
      "learning-review",
    ]);
    expect(preview.tasks.map((task) => task.feature)).toContain("Agent concepts");
    expect(preview.tasks.map((task) => task.feature)).not.toContain("Task creation");
    expect(progressEvents.some((event) => event.includes("Planner is creating"))).toBe(true);
    expect(preview.artifacts?.[0]?.content).toContain("学习 Agent");
  });

  it("streams native DeepAgents tool events into mission progress", async () => {
    const progressEvents: string[] = [];
    const model = {
      withConfig: () => model,
      async *streamEvents() {
        yield {
          event: "on_tool_start",
          name: "write_todos",
          data: {
            input: {
              todos: [
                { content: "Plan scoreboard app", status: "in_progress" },
                { content: "Build scoring controls", status: "pending" },
              ],
            },
          },
        };
        yield {
          event: "on_tool_start",
          name: "task",
          data: {
            input: {
              description: "Builder should implement team scoring controls.",
              subagent_type: "builder",
            },
          },
        };
        yield {
          event: "on_tool_end",
          name: "task",
          data: {
            output: "Builder returned a complete scoreboard artifact.",
          },
        };
        yield {
          event: "on_chain_end",
          name: "meta-agent",
          data: {
            output: {
              messages: [
                {
                  content:
                    "```html filename=\"index.html\"\n<!doctype html><html><body><main>Scoreboard<script>let score=0</script></main></body></html>\n```",
                },
              ],
            },
          },
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "做一个比赛积分应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        progressEvents.push(update.preview.events.at(-1)?.message ?? "");
      },
    );

    expect(progressEvents).toEqual(
      expect.arrayContaining([
        "DeepAgents updated todos: Plan scoreboard app; Build scoring controls",
        "DeepAgents delegated task to builder: Builder should implement team scoring controls.",
        "DeepAgents completed task: Builder returned a complete scoreboard artifact.",
      ]),
    );
    expect(preview.events.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "DeepAgents updated todos: Plan scoreboard app; Build scoring controls",
        "DeepAgents delegated task to builder: Builder should implement team scoring controls.",
        "DeepAgents completed task: Builder returned a complete scoreboard artifact.",
      ]),
    );
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
  });

  it("extracts artifacts written to native DeepAgents state files", async () => {
    const model = {
      withConfig: () => model,
      invoke: async () => ({
        messages: [
          {
            content:
              "I wrote the requested app to /artifacts/index.html and verified the MVP.",
          },
        ],
        files: {
          "/artifacts/index.html": {
            content:
              "<!doctype html><html><body><main>Scoreboard<button>+1</button><script>localStorage.setItem('scores','[]')</script></main></body></html>",
            created_at: "2026-05-12T00:00:00.000Z",
            modified_at: "2026-05-12T00:00:00.000Z",
          },
          "/skills/system-artifact-generation/SKILL.md": {
            content: ["# Internal skill"],
            created_at: "2026-05-12T00:00:00.000Z",
            modified_at: "2026-05-12T00:00:00.000Z",
          },
        },
      }),
    };

    const preview = await runMultiAgentMission(
      "做一个比赛积分应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.error).toBeUndefined();
    expect(preview.finalBrief).toContain("Native DeepAgents");
    expect(preview.artifacts?.[0]).toMatchObject({
      filename: "index.html",
      type: "html",
    });
    expect(preview.artifacts?.[0]?.content).toContain("localStorage");
  });

  it("keeps streamed native DeepAgents final state when later tool events finish", async () => {
    const model = {
      withConfig: () => model,
      async *streamEvents() {
        yield {
          event: "on_tool_start",
          name: "search_capabilities",
          data: { input: { query: "scoreboard app" } },
        };
        yield {
          event: "on_chain_end",
          name: "meta-agent",
          data: {
            output: {
              messages: [
                {
                  content:
                    "I wrote the requested app to /artifacts/index.html.",
                },
              ],
              files: {
                "/artifacts/index.html": {
                  content:
                    "<!doctype html><html><body><main>Scoreboard<button>+1</button></main></body></html>",
                  mimeType: "text/html",
                  created_at: "2026-05-12T00:00:00.000Z",
                  modified_at: "2026-05-12T00:00:00.000Z",
                },
              },
            },
          },
        };
        yield {
          event: "on_tool_end",
          name: "search_capabilities",
          data: {
            output:
              "[{\"id\":\"app-builder\",\"name\":\"App Builder\",\"description\":\"Builds apps\"}]",
          },
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "做一个比赛积分应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.error).toBeUndefined();
    expect(preview.finalBrief).toContain("Native DeepAgents");
    expect(preview.events.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "DeepAgents started tool search_capabilities.",
        "DeepAgents completed tool search_capabilities.",
      ]),
    );
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
    expect(preview.artifacts?.[0]?.content).toContain("Scoreboard");
  });

  it("extracts artifacts from native DeepAgents task command file updates", async () => {
    const model = {
      withConfig: () => model,
      async *streamEvents() {
        yield {
          event: "on_tool_end",
          name: "task",
          data: {
            output: {
              lg_name: "Command",
              update: {
                files: {
                  "/artifacts/index.html": {
                    content:
                      "<!doctype html><html><body><main>Vote<button>投票</button><script>localStorage.setItem('votes','[]')</script></main></body></html>",
                    mimeType: "text/html",
                    created_at: "2026-05-12T00:00:00.000Z",
                    modified_at: "2026-05-12T00:00:00.000Z",
                  },
                },
              },
            },
          },
        };
        yield {
          event: "on_chain_end",
          name: "meta-agent",
          data: {
            output: {
              messages: [{ content: "The voting app was written to /artifacts/index.html." }],
            },
          },
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "做一个投票应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.[0]).toMatchObject({
      filename: "index.html",
      type: "html",
    });
    expect(preview.artifacts?.[0]?.content).toContain("votes");
  });

  it("extracts artifacts submitted through the native submit_artifact tool", async () => {
    const model = {
      withConfig: () => model,
      async *streamEvents() {
        yield {
          event: "on_tool_end",
          name: "submit_artifact",
          data: {
            output: JSON.stringify({
              files: {
                "/artifacts/index.html": {
                  content:
                    "<!doctype html><html><body><main>Poll<button>Vote</button><script>localStorage.setItem('poll','[]')</script></main></body></html>",
                  mimeType: "text/html",
                  created_at: "2026-05-12T00:00:00.000Z",
                  modified_at: "2026-05-12T00:00:00.000Z",
                },
              },
            }),
          },
        };
        yield {
          event: "on_chain_end",
          name: "meta-agent",
          data: {
            output: {
              messages: [{ content: "Submitted index.html." }],
            },
          },
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "做一个投票应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.error).toBeUndefined();
    expect(preview.events.map((event) => event.message)).toContain(
      "DeepAgents submitted artifact: index.html",
    );
    expect(preview.finalBrief).toContain("Native DeepAgents");
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
    expect(preview.artifacts?.[0]?.content).toContain("poll");
  });

  it("finishes native DeepAgents as soon as an artifact file is written", async () => {
    let yieldedAfterArtifact = false;
    const model = {
      withConfig: () => model,
      async *streamEvents() {
        yield {
          event: "on_tool_end",
          name: "write_file",
          data: {
            output: {
              update: {
                files: {
                  "/artifacts/index.html": {
                    content:
                      "<!doctype html><html><body><main>Poll<button>Vote</button><script>localStorage.setItem('early-poll','[]')</script></main></body></html>",
                    mimeType: "text/html",
                    created_at: "2026-05-12T00:00:00.000Z",
                    modified_at: "2026-05-12T00:00:00.000Z",
                  },
                },
              },
            },
          },
        };
        yieldedAfterArtifact = true;
        yield {
          event: "on_tool_start",
          name: "slow_summary",
          data: {},
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "做一个投票应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(yieldedAfterArtifact).toBe(false);
    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
    expect(preview.artifacts?.[0]?.content).toContain("early-poll");
  });

  it("runs a native DeepAgents closure pass before falling back when no artifact is submitted", async () => {
    const progressEvents: string[] = [];
    let streamRuns = 0;
    const model = {
      withConfig: () => model,
      async *streamEvents(input: unknown) {
        streamRuns += 1;
        const prompt = JSON.stringify(input);
        if (streamRuns === 1) {
          yield {
            event: "on_tool_start",
            name: "write_todos",
            data: {
              input: {
                todos: [
                  { content: "Plan the poll MVP", status: "in_progress" },
                  { content: "Submit the runnable artifact", status: "pending" },
                ],
              },
            },
          };
          yield {
            event: "on_chain_end",
            name: "meta-agent",
            data: {
              output: {
                messages: [{ content: "I planned the mission but did not submit a file." }],
              },
            },
          };
          return;
        }

        expect(prompt).toContain("Complete the native DeepAgents artifact handoff");
        yield {
          event: "on_tool_end",
          name: "submit_artifact",
          data: {
            output: JSON.stringify({
              files: {
                "/artifacts/index.html": {
                  content:
                    "<!doctype html><html><body><main>Poll<button>Vote</button><script>localStorage.setItem('closure-poll','[]')</script></main></body></html>",
                  mimeType: "text/html",
                  created_at: "2026-05-12T00:00:00.000Z",
                  modified_at: "2026-05-12T00:00:00.000Z",
                },
              },
            }),
          },
        };
        yield {
          event: "on_chain_end",
          name: "meta-agent",
          data: {
            output: {
              messages: [{ content: "Submitted the poll MVP artifact." }],
            },
          },
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "生成一个极简投票网页应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        progressEvents.push(update.preview.events.at(-1)?.message ?? "");
      },
    );

    expect(streamRuns).toBe(2);
    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
    expect(preview.artifacts?.[0]?.content).toContain("closure-poll");
    expect(preview.finalBrief).toContain("Native DeepAgents");
    expect(preview.events.map((event) => event.message)).toContain(
      "Native DeepAgents is completing the artifact handoff before fallback.",
    );
    expect(preview.events.map((event) => event.message)).toContain(
      "DeepAgents submitted artifact: index.html",
    );
    expect(preview.events.some((event) => event.message.includes("falling back"))).toBe(
      false,
    );
    expect(progressEvents).toContain("DeepAgents submitted artifact: index.html");
  });

  it("recovers with native closure when the first DeepAgents stream terminates", async () => {
    let streamRuns = 0;
    const model = {
      withConfig: () => model,
      async *streamEvents() {
        streamRuns += 1;
        if (streamRuns === 1) {
          yield {
            event: "on_tool_start",
            name: "write_todos",
            data: {
              input: {
                todos: [{ content: "Plan the calculator MVP", status: "in_progress" }],
              },
            },
          };
          throw new Error("terminated");
        }

        yield {
          event: "on_tool_end",
          name: "submit_artifact",
          data: {
            output: JSON.stringify({
              files: {
                "/artifacts/index.html": {
                  content:
                    "<!doctype html><html><body><main>Calculator<button>=</button><script>localStorage.setItem('calc','ready')</script></main></body></html>",
                  mimeType: "text/html",
                  created_at: "2026-05-12T00:00:00.000Z",
                  modified_at: "2026-05-12T00:00:00.000Z",
                },
              },
            }),
          },
        };
        yield {
          event: "on_chain_end",
          name: "meta-agent",
          data: { output: { messages: [{ content: "Recovered and submitted index.html." }] } },
        };
      },
      invoke: async () => {
        throw new Error("Native stream path should not call invoke.");
      },
    };

    const preview = await runMultiAgentMission(
      "生成一个计算器网页应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(streamRuns).toBe(2);
    expect(preview.error).toBeUndefined();
    expect(preview.events.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "DeepAgents updated todos: Plan the calculator MVP",
        "DeepAgents stream stopped before artifact handoff: terminated",
        "Native DeepAgents is completing the artifact handoff before fallback.",
        "DeepAgents submitted artifact: index.html",
      ]),
    );
    expect(preview.events.some((event) => event.message.includes("falling back"))).toBe(
      false,
    );
    expect(preview.artifacts?.[0]?.content).toContain("calc");
  });

  it("repairs coarse software plans before falling back to generic execution tasks", async () => {
    const runningTaskCounts: number[] = [];
    const model = {
      plannerCalls: 0,
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          model.plannerCalls += 1;
          if (model.plannerCalls > 1) {
            return {
              content: [
                "```json filename=\"planner-output.json\"",
                JSON.stringify({
                  finalBrief: "Planner repaired the coarse todo plan.",
                  artifactKind: "web_app",
                  requiredSkills: ["software implementation"],
                  selectedCapabilityIds: ["app-builder"],
                  tasks: [
                    {
                      id: "board-columns",
                      section: "Board",
                      feature: "Kanban columns",
                      title: "Create board columns",
                      description: "Implement Todo, Doing, and Done lanes with counts.",
                      assignedTo: "App Builder",
                      assignedAgentId: "builder",
                      requiredSkills: ["software implementation"],
                      dependencies: [],
                      expectedArtifact: "board columns",
                      status: "queued",
                    },
                    {
                      id: "project-selector",
                      section: "Projects",
                      feature: "Project selector",
                      title: "Build project selector",
                      description: "Let users select a project for each todo.",
                      assignedTo: "App Builder",
                      assignedAgentId: "builder",
                      requiredSkills: ["state management"],
                      dependencies: ["board-columns"],
                      expectedArtifact: "project selector",
                      status: "queued",
                    },
                    {
                      id: "todo-card-crud",
                      section: "Tasks",
                      feature: "Todo card CRUD",
                      title: "Build todo card CRUD",
                      description: "Add, edit, delete, and move todo cards.",
                      assignedTo: "App Builder",
                      assignedAgentId: "builder",
                      requiredSkills: ["software implementation"],
                      dependencies: ["project-selector"],
                      expectedArtifact: "todo interactions",
                      status: "queued",
                    },
                    {
                      id: "todo-review",
                      section: "Quality",
                      feature: "Acceptance check",
                      title: "Review todo board",
                      description: "Verify the project board and todo interactions.",
                      assignedTo: "QA Reviewer",
                      assignedAgentId: "reviewer",
                      requiredSkills: ["quality review"],
                      dependencies: ["todo-card-crud"],
                      expectedArtifact: "review",
                      status: "queued",
                    },
                  ],
                }),
                "```",
              ].join("\n"),
            };
          }

          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Planner returned a coarse app plan.",
                artifactKind: "web_app",
                requiredSkills: ["software implementation"],
                selectedCapabilityIds: ["app-builder"],
                tasks: [
                  {
                    id: "build",
                    title: "Build artifact",
                    description: "Create the todo board app.",
                    assignedTo: "Builder",
                    status: "queued",
                  },
                  {
                    id: "review",
                    title: "Review artifact",
                    description: "Review the todo board app.",
                    assignedTo: "Reviewer",
                    status: "queued",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><main><input><button>Add</button><section>Project</section><script>localStorage.setItem('todos','[]')</script></main></body></html>\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"OK\"}\n```",
        };
      },
    };

    const preview = await runMultiAgentMission(
      "帮我写一个简单的todo list 看板board，带project的",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        if (update.stage === "building") {
          runningTaskCounts.push(
            update.preview.tasks.filter((task) => task.status === "running").length,
          );
        }
      },
    );

    expect(model.plannerCalls).toBe(2);
    expect(preview.tasks.map((task) => task.id)).toEqual([
      "board-columns",
      "project-selector",
      "todo-card-crud",
      "todo-review",
    ]);
    expect(preview.tasks.map((task) => task.section)).toEqual(
      expect.arrayContaining(["Projects", "Board", "Tasks", "Quality"]),
    );
    expect(Math.max(...runningTaskCounts)).toBe(3);
    expect(preview.events.some((event) => event.message.includes("feature-level"))).toBe(true);
  });

  it("asks builder for an MVP-first artifact instead of a complete all-at-once app", async () => {
    const calls: string[] = [];
    let builderPrompt = "";
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          calls.push("planner");
          return {
            content:
              "```json filename=\"planner-output.json\"\n{\"finalBrief\":\"Build Anki MVP.\",\"artifactKind\":\"web_app\",\"requiredSkills\":[\"software implementation\"],\"tasks\":[{\"id\":\"build-anki\",\"title\":\"Build Anki study app\",\"description\":\"Create flashcards, review, flip, grade, and save state.\",\"assignedTo\":\"Builder\",\"assignedAgentId\":\"builder\",\"status\":\"queued\"}]}\n```",
          };
        }

        if (prompt.includes("You are Builder.")) {
          calls.push("builder");
          builderPrompt = prompt;
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><main><input id=\"front\"><input id=\"back\"><button>Add</button><button>Flip</button><script>localStorage.setItem('anki-cards','[]')</script></main></body></html>\n```",
          };
        }

        if (prompt.includes("Reviewer agent")) {
          calls.push("reviewer");
          return {
            content:
              "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"Anki MVP accepted.\"}\n```",
          };
        }

        throw new Error("Unexpected prompt");
      },
    };

    const preview = await runMultiAgentMission(
      "我想要一个类似anki的应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(calls).toEqual(["planner", "builder", "reviewer"]);
    expect(builderPrompt).toContain("Build the smallest usable MVP first");
    expect(builderPrompt).toContain("Prefer a compact MVP artifact");
    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
    expect(preview.artifacts?.[0]?.content).toContain("anki-cards");
  });

  it("does not select planner tasks as artifact build tasks", async () => {
    const runningAgents: string[] = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content:
              "```json filename=\"planner-output.json\"\n{\"finalBrief\":\"Fallback-style plan.\",\"artifactKind\":\"web_app\",\"requiredSkills\":[\"software implementation\"],\"tasks\":[{\"id\":\"task-1\",\"title\":\"Shape the product\",\"description\":\"Clarify the Anki MVP.\",\"assignedTo\":\"Product Planner\",\"assignedAgentId\":\"planner\",\"status\":\"queued\"},{\"id\":\"task-2\",\"title\":\"Build artifact\",\"description\":\"Create the first usable Anki MVP.\",\"assignedTo\":\"Builder\",\"assignedAgentId\":\"builder\",\"status\":\"queued\"},{\"id\":\"task-3\",\"title\":\"Review artifact\",\"description\":\"Review the MVP.\",\"assignedTo\":\"Reviewer\",\"assignedAgentId\":\"reviewer\",\"status\":\"queued\"}]}\n```",
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><button>Flip</button><script>localStorage.setItem('anki','[]')</script></body></html>\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"OK\"}\n```",
        };
      },
    };

    await runMultiAgentMission(
      "我想要一个类似anki的应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        if (update.stage === "building") {
          runningAgents.push(
            ...update.preview.tasks
              .filter((task) => task.status === "running")
              .map((task) => task.assignedTo),
          );
        }
      },
    );

    expect(runningAgents).toContain("Builder");
    expect(runningAgents).not.toContain("Product Planner");
  });

  it("announces builder as the artifact owner when planner and builder tasks both exist", async () => {
    const buildEvents: string[] = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content:
              "```json filename=\"planner-output.json\"\n{\"finalBrief\":\"Fallback-style plan.\",\"artifactKind\":\"web_app\",\"requiredSkills\":[\"software implementation\"],\"tasks\":[{\"id\":\"task-1\",\"title\":\"Shape the product\",\"description\":\"Clarify the app MVP.\",\"assignedTo\":\"Product Planner\",\"assignedAgentId\":\"planner\",\"status\":\"queued\"},{\"id\":\"task-2\",\"title\":\"Build artifact\",\"description\":\"Create the first usable MVP.\",\"assignedTo\":\"Builder\",\"assignedAgentId\":\"builder\",\"status\":\"queued\"},{\"id\":\"task-3\",\"title\":\"Review artifact\",\"description\":\"Review the MVP.\",\"assignedTo\":\"Reviewer\",\"assignedAgentId\":\"reviewer\",\"status\":\"queued\"}]}\n```",
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><button>Flip</button><script>localStorage.setItem('anki','[]')</script></body></html>\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"OK\"}\n```",
        };
      },
    };

    await runMultiAgentMission(
      "我想要一个类似anki的应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
      async (update) => {
        const lastEvent = update.preview.events.at(-1)?.message ?? "";
        if (lastEvent.includes("started") && lastEvent.includes("feature task")) {
          buildEvents.push(lastEvent);
        }
      },
    );

    expect(buildEvents).toContain("Builder started 1 feature task(s).");
    expect(buildEvents).not.toContain("Product Planner started 1 feature task(s).");
  });

  it("routes follow-up prompts through planner, builder, and reviewer even when an artifact already exists", async () => {
    const calls: string[] = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          calls.push("planner");
          return {
            content:
              "```json filename=\"planner-output.json\"\n{\"finalBrief\":\"Plan the requested improvement.\",\"artifactKind\":\"web_app\",\"requiredSkills\":[\"software implementation\"],\"tasks\":[{\"id\":\"improve-artifact\",\"title\":\"Improve artifact\",\"description\":\"Apply the user's follow-up request to the existing artifact.\",\"assignedTo\":\"Builder\",\"assignedAgentId\":\"builder\",\"status\":\"queued\"}]}\n```",
          };
        }

        if (prompt.includes("Update the existing product")) {
          calls.push("builder");
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><input id='front'><input id='back'><button>Flip</button><button>Again</button><button>Good</button><button>Easy</button><script>localStorage.setItem('anki-cards','[]')</script></body></html>\n```",
          };
        }

        if (prompt.includes("Reviewer agent")) {
          calls.push("reviewer");
          return {
            content:
              "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"Follow-up artifact accepted.\"}\n```",
          };
        }

        throw new Error("Unexpected prompt");
      },
    };
    const previousPreview = {
      mission: "我想要一个类似anki的应用",
      selectedCapabilities: [],
      ephemeralAgents: [],
      tasks: [],
      events: [],
      artifacts: [
        {
          id: "artifact-1",
          filename: "index.html",
          type: "html" as const,
          title: "index.html",
          description: "Anki MVP",
          content:
            "<!doctype html><html><body><input id='front'><input id='back'><button>Flip</button><button>Again</button><button>Good</button><script>localStorage.setItem('anki-cards','[]')</script></body></html>",
        },
      ],
      finalBrief: "Anki MVP is ready.",
    };

    const preview = await runMissionIteration(
      "我想要一个类似anki的应用",
      "继续生成最小 Anki MVP。只要一个单文件 HTML，可添加正反面卡片、翻面、Again/Good、localStorage 保存。",
      previousPreview,
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(calls).toEqual(["planner", "builder", "reviewer"]);
    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.[0]?.filename).toBe("index.html");
    expect(preview.artifacts?.[0]?.content).toContain("Easy");
    expect(preview.finalBrief).toContain("Follow-up artifact accepted");
  });

  it("can still extract legacy mission-run reports from model text", () => {
    const report = extractRunReportFromText(
      [
        "```json filename=\"mission-run.json\"",
        JSON.stringify({
          finalBrief: "Generated by the live model.",
          tasks: [
            {
              id: "task-1",
              title: "Generate app",
              description: "Create index.html.",
              assignedTo: "App builder",
              status: "done",
            },
          ],
          runLogs: [
              {
                agent: "App builder",
                taskId: "task-1",
                level: "info",
                message: "Created index.html from the model response.",
              },
            ],
          }),
          "```",
        ].join("\n"),
    );

    expect(report?.runLogs).toHaveLength(1);
  });

  it("runs planner, builder, reviewer, and one repair as separate agent calls", async () => {
    const calls: string[] = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          calls.push("planner");
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                tasks: [
                  {
                    id: "task-1",
                    title: "Build todo app",
                    description: "Create a complete HTML todo app.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
                finalBrief: "Planner assigned a builder task.",
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("Repair the artifact")) {
          calls.push("repair");
          return {
            content: [
              "```html filename=\"index.html\"",
              "<!doctype html><html><body><main><input id=\"todo\"><button>Add</button><script>localStorage.setItem('todos','[]')</script></main></body></html>",
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          calls.push("builder");
          return {
            content: [
              "```html filename=\"index.html\"",
              "<!doctype html><html><body><h1>Todo</h1></body></html>",
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("Reviewer agent")) {
          calls.push("reviewer");
          return {
            content: [
              "```json filename=\"review.json\"",
              JSON.stringify({
                passed: false,
                issues: ["Missing persistence"],
                requiredFixes: ["Add localStorage persistence"],
                summary: "Needs one repair pass.",
              }),
              "```",
            ].join("\n"),
          };
        }

        throw new Error("Unexpected prompt");
      },
    };

    const preview = await runMultiAgentMission(
      "生成一个 todolist web 应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(calls).toEqual(["planner", "builder", "reviewer", "repair"]);
    expect(preview.mode).toBe("deepagents");
    expect(preview.tasks.every((task) => task.status === "done")).toBe(true);
    expect(preview.runLogs?.map((log) => log.agent)).toEqual(
      expect.arrayContaining(["Planner", "Builder", "Reviewer"]),
    );
    expect(preview.artifacts?.[0]?.content).toContain("localStorage");
    expect(preview.finalBrief).toContain("repair");
  });

  it("keeps the original artifact and marks the run failed when repair returns only review metadata", async () => {
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Planner assigned the app build.",
                tasks: [
                  {
                    id: "task-1",
                    title: "Generate app",
                    description: "Create index.html.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.") && prompt.includes("Repair the artifact")) {
          return {
            content: [
              "```json filename=\"review.json\"",
              JSON.stringify({
                status: "repaired",
                artifacts: [{ filename: "index.html", type: "text/html" }],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content: [
              "```html filename=\"index.html\"",
              "<!doctype html><html><body><h1>Todo</h1></body></html>",
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("Reviewer agent")) {
          return {
            content: [
              "```json filename=\"review.json\"",
              JSON.stringify({
                passed: false,
                issues: ["Needs persistence"],
                requiredFixes: ["Add localStorage persistence"],
                summary: "Needs repair.",
              }),
              "```",
            ].join("\n"),
          };
        }

        throw new Error("Unexpected prompt");
      },
    };

    const preview = await runMultiAgentMission(
      "生成一个 todolist web 应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.artifacts?.map((artifact) => artifact.filename)).toEqual(["index.html"]);
    expect(preview.error).toContain("repair");
    expect(preview.finalBrief).toContain("did not return");
  });

  it("keeps a generated artifact ready when reviewer output is malformed without required fixes", async () => {
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Plan.",
                artifactKind: "slide_deck",
                requiredSkills: ["presentations"],
                selectedCapabilityIds: ["presentation-builder"],
                tasks: [
                  {
                    id: "task-1",
                    title: "Build app",
                    description: "Create index.html.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body>Todo</body></html>\n```",
          };
        }

        return { content: "Reviewer says it looks mostly fine." };
      },
    };

    const preview = await runMultiAgentMission(
      "生成一个 todolist web 应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.map((artifact) => artifact.filename)).toEqual(["index.html"]);
    expect(preview.finalBrief).toContain("repair");
  });

  it("keeps generated artifacts ready when reviewer times out", async () => {
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Planner selected app build.",
                artifactKind: "web_app",
                requiredSkills: ["software implementation"],
                selectedCapabilityIds: ["app-builder"],
                tasks: [
                  {
                    id: "task-1",
                    title: "Build app",
                    description: "Create the app artifact.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.")) {
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><main><input><button>Add</button><script>localStorage.setItem('todos','[]')</script></main></body></html>\n```",
          };
        }

        throw new Error("Model call timed out after 45 seconds.");
      },
    };

    const preview = await runMultiAgentMission(
      "生成一个 todolist web 应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(preview.error).toBeUndefined();
    expect(preview.artifacts?.map((artifact) => artifact.filename)).toEqual(["index.html"]);
    expect(preview.runLogs?.some((log) => log.level === "warning")).toBe(true);
  });

  it("lets the builder choose React project files instead of forcing HTML", async () => {
    let builderPrompt = "";
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Plan.",
                artifactKind: "web_app",
                requiredSkills: ["software implementation"],
                selectedCapabilityIds: ["app-builder"],
                tasks: [
                  {
                    id: "task-1",
                    title: "Build app",
                    description: "Create index.html.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.") && !prompt.includes("Repair the artifact")) {
          builderPrompt = prompt;
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><input><button>Add</button><ul></ul><script>localStorage.setItem('todos','[]')</script></body></html>\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"OK\"}\n```",
        };
      },
    };

    await runMultiAgentMission(
      "生成一个 todolist web 应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(builderPrompt).toContain("Return named fenced code blocks");
    expect(builderPrompt).toContain("Planner artifactKind: web_app");
    expect(builderPrompt).toContain("Planner requiredSkills: software implementation");
    expect(builderPrompt).toContain("Do not re-classify the mission from keywords");
    expect(builderPrompt).toContain("Do not build a requirements clarification page");
    expect(builderPrompt).toContain("Implement the user's requested artifact directly");
  });

  it("asks the builder for slide deck artifacts for PPT missions", async () => {
    let builderPrompt = "";
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Plan.",
                artifactKind: "slide_deck",
                requiredSkills: ["presentations"],
                selectedCapabilityIds: ["presentation-builder"],
                tasks: [
                  {
                    id: "task-1",
                    title: "Build deck",
                    description: "Create a pitch deck artifact.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("You are Builder.") && !prompt.includes("Repair the artifact")) {
          builderPrompt = prompt;
          return {
            content:
              "```markdown filename=\"deck.md\"\n# Slide 1\n融资路演\n```",
          };
        }

        return {
          content:
            "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"OK\"}\n```",
        };
      },
    };

    await runMultiAgentMission(
      "帮我做一个融资路演 PPT",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(builderPrompt).toContain("Planner artifactKind: slide_deck");
    expect(builderPrompt).toContain("Planner requiredSkills: presentations");
    expect(builderPrompt).toContain("presentation skill");
    expect(builderPrompt).toContain("deck.md");
  });

  it("rejects clarification-page artifacts for software missions and repairs them", async () => {
    const calls: string[] = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          return { content: "Planner could not emit JSON." };
        }

        if (prompt.includes("Repair the artifact")) {
          calls.push("repair");
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><body><main><h1>番茄钟</h1><button>开始</button><script>let seconds=1500;</script></main></body></html>\n```",
          };
        }

        if (prompt.includes("You are Builder.")) {
          calls.push("builder");
          return {
            content:
              "```html filename=\"index.html\"\n<!doctype html><html><head><title>番茄钟任务澄清</title></head><body>需求澄清器</body></html>\n```",
          };
        }

        if (prompt.includes("Reviewer agent")) {
          calls.push("reviewer");
          return {
            content:
              "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"Looks ok\"}\n```",
          };
        }

        throw new Error("Unexpected prompt");
      },
    };

    const preview = await runMultiAgentMission(
      "帮我生成一个番茄钟网页应用",
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(calls).toEqual(["builder", "reviewer", "repair"]);
    expect(preview.artifacts?.[0]?.content).toContain("let seconds=1500");
    expect(preview.artifacts?.[0]?.content).not.toContain("需求澄清器");
  });

  it("updates an existing mission from a follow-up prompt", async () => {
    const calls: string[] = [];
    const previousPreview = buildMissionPreview("生成一个 React dashboard 应用");
    previousPreview.artifacts = [
      {
        id: "artifact-1",
        type: "react",
        filename: "src/App.jsx",
        title: "src/App.jsx",
        description: "Existing app.",
        content: "export default function App(){ return <button>Add</button> }",
      },
    ];

    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        const prompt = messages.map((message) => message.content).join("\n");
        if (prompt.includes("Planner agent")) {
          calls.push("planner");
          return {
            content: [
              "```json filename=\"planner-output.json\"",
              JSON.stringify({
                finalBrief: "Planner assigned the update.",
                tasks: [
                  {
                    id: "task-1",
                    title: "Improve app",
                    description: "Add dark mode.",
                    assignedTo: "Builder",
                    status: "running",
                  },
                ],
              }),
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("Update the existing product")) {
          calls.push("builder");
          return {
            content: [
              "```jsx filename=\"src/App.jsx\"",
              "export default function App(){ return <button>Dark mode</button> }",
              "```",
            ].join("\n"),
          };
        }

        if (prompt.includes("Reviewer agent")) {
          calls.push("reviewer");
          return {
            content:
              "```json filename=\"review.json\"\n{\"passed\":true,\"issues\":[],\"requiredFixes\":[],\"summary\":\"Updated app accepted.\"}\n```",
          };
        }

        throw new Error("Unexpected prompt");
      },
    };

    const preview = await runMissionIteration(
      "生成一个 React dashboard 应用",
      "加一个暗色模式",
      previousPreview,
      undefined,
      model as never,
      createDefaultAgentProfiles(),
    );

    expect(calls).toEqual(["planner", "builder", "reviewer"]);
    expect(preview.artifacts?.[0]).toMatchObject({
      filename: "src/App.jsx",
      type: "react",
    });
    expect(preview.artifacts?.[0]?.content).toContain("Dark mode");
    expect(preview.finalBrief).toContain("Updated app accepted");
  });
});
