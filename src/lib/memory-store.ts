import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";

import type {
  BackendProtocolV2,
  EditResult,
  FileData,
  GlobResult,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from "deepagents";
import type { StoredMission } from "./mission-store";

const defaultDataDir = join(process.cwd(), ".metaflow-data");
const memoriesDirname = "memories";

const defaultPreferences = [
  "# User preferences",
  "",
  "- No durable user preferences have been recorded yet.",
  "",
].join("\n");

const defaultMetaAgentLessons = [
  "# Meta Agent lessons",
  "",
  "- Plan work as mission sections and user-visible feature tasks.",
  "- Prefer DeepAgents write_todos and task delegation as the source of truth for live task state.",
  "- Do not infer feature tasks from mission keywords.",
  "",
].join("\n");

export class FileMemoryStore {
  private readonly rootDir: string;

  constructor(private readonly dataDir = defaultDataDir) {
    this.rootDir = join(dataDir, memoriesDirname);
  }

  async read(path: string): Promise<string> {
    return readFile(this.resolvePath(path), "utf8");
  }

  async write(path: string, content: string): Promise<void> {
    const filePath = this.resolvePath(path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  async edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<number> {
    const current = await this.read(path);
    if (!oldString) {
      throw new Error("oldString cannot be empty.");
    }

    const occurrences = current.split(oldString).length - 1;
    if (occurrences === 0) {
      throw new Error(`String not found in memory file: ${oldString}`);
    }

    const updated = replaceAll
      ? current.split(oldString).join(newString)
      : current.replace(oldString, newString);
    await this.write(path, updated);
    return replaceAll ? occurrences : 1;
  }

  async list(path = ""): Promise<string[]> {
    await mkdir(this.rootDir, { recursive: true });
    const directory = this.resolvePath(path);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    return entries
      .map((entry) => normalizeMemoryPath(join(directory, entry.name), this.rootDir, entry.isDirectory()))
      .sort();
  }

  async listFiles(path = ""): Promise<string[]> {
    await mkdir(this.rootDir, { recursive: true });
    const directory = this.resolvePath(path);
    return walkMemoryFiles(directory, this.rootDir);
  }

  private resolvePath(path: string): string {
    const normalized = normalizeInputPath(path);
    const resolved = join(this.rootDir, normalized);
    const relativePath = relative(this.rootDir, resolved);
    if (relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
      throw new Error(`Invalid memory path: ${path}`);
    }

    return resolved;
  }
}

export type MemoryFile = {
  path: string;
  content: string;
};

export async function createMetaAgentMemoryFiles(
  store = new FileMemoryStore(),
): Promise<string[]> {
  await ensureMemoryFile(store, "users/default/preferences.md", defaultPreferences);
  await ensureMemoryFile(store, "agents/meta-agent/lessons.md", defaultMetaAgentLessons);

  return [
    "/memories/preferences.md",
    "/memories/meta-agent-lessons.md",
  ];
}

export async function listMemoryFiles(
  store = new FileMemoryStore(),
): Promise<MemoryFile[]> {
  await createMetaAgentMemoryFiles(store);
  const paths = await store.listFiles();
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await store.read(path),
    })),
  );
}

export async function writeMissionMemorySummary(
  mission: StoredMission,
  store = new FileMemoryStore(),
): Promise<string> {
  const content = formatMissionMemorySummary(mission);
  const path = `missions/${mission.id}/summary.md`;
  await store.write(path, content);
  return path;
}

export function formatMissionMemorySummary(mission: StoredMission): string {
  const preview = mission.preview;
  const tasks = preview?.tasks ?? [];
  const artifacts = preview?.artifacts ?? [];
  const events = preview?.events ?? [];
  const runLogs = preview?.runLogs ?? [];
  const lines = [
    `# ${mission.title}`,
    "",
    `- Mission ID: ${mission.id}`,
    `- Status: ${mission.status}`,
    `- Stage: ${mission.stage}`,
    `- Created: ${mission.createdAt}`,
    `- Updated: ${mission.updatedAt}`,
    "",
    "## User Request",
    "",
    mission.input || "No request recorded.",
    "",
    "## Final Brief",
    "",
    preview?.finalBrief || mission.error || "No final brief recorded yet.",
    "",
    "## Feature Tasks",
    "",
    tasks.length
      ? tasks
          .map((task) => {
            const featurePath = [task.section, task.feature].filter(Boolean).join(" / ");
            const prefix = featurePath || task.title;
            const details = [
              task.description,
              `assigned to ${task.assignedTo}`,
              `status ${task.status}`,
              task.expectedArtifact ? `artifact ${task.expectedArtifact}` : "",
            ].filter(Boolean);
            return `- ${prefix}: ${details.join("; ")}`;
          })
          .join("\n")
      : "- No feature tasks recorded.",
    "",
    "## Artifacts",
    "",
    artifacts.length
      ? artifacts
          .map(
            (artifact) =>
              `- ${artifact.filename}: ${artifact.title || artifact.description || artifact.type}`,
          )
          .join("\n")
      : "- No artifacts recorded.",
    "",
    "## Recent Events",
    "",
    events.length
      ? events
          .slice(-10)
          .map((event) => `- ${event.type}: ${event.message}`)
          .join("\n")
      : "- No events recorded.",
    "",
    "## Run Logs",
    "",
    runLogs.length
      ? runLogs
          .slice(-10)
          .map((log) => `- ${log.level} / ${log.agent} / ${log.taskId}: ${log.message}`)
          .join("\n")
      : "- No run logs recorded.",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

export function createMemoryBackend(store = new FileMemoryStore()): BackendProtocolV2 {
  return new FileMemoryBackend(store);
}

class FileMemoryBackend implements BackendProtocolV2 {
  constructor(private readonly store: FileMemoryStore) {}

  async ls(path: string): Promise<LsResult> {
    const memoryPath = backendPathToMemoryPath(path);
    const files = await this.store.list(memoryPath);
    return {
      files: await Promise.all(
        files.map(async (file) => {
          const isDirectory = file.endsWith("/");
          return {
            path: `/${file}`,
            is_dir: isDirectory,
            size: isDirectory ? undefined : (await this.readRaw(`/${file}`)).data?.content.length,
          };
        }),
      ),
    };
  }

  async read(filePath: string, offset = 0, limit = 500): Promise<ReadResult> {
    try {
      const content = await this.store.read(backendPathToMemoryPath(filePath));
      return {
        content: paginateText(content, offset, limit),
        mimeType: "text/markdown",
      };
    } catch (error) {
      return { error: formatMemoryError(error) };
    }
  }

  async readRaw(filePath: string): Promise<ReadRawResult> {
    try {
      return {
        data: createMemoryFileData(await this.store.read(backendPathToMemoryPath(filePath))),
      };
    } catch (error) {
      return { error: formatMemoryError(error) };
    }
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      await this.store.write(backendPathToMemoryPath(filePath), content);
      return {
        path: filePath,
        filesUpdate: null,
      };
    } catch (error) {
      return { error: formatMemoryError(error) };
    }
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<EditResult> {
    try {
      const occurrences = await this.store.edit(
        backendPathToMemoryPath(filePath),
        oldString,
        newString,
        replaceAll,
      );
      return {
        path: filePath,
        occurrences,
        filesUpdate: null,
      };
    } catch (error) {
      return { error: formatMemoryError(error) };
    }
  }

  async grep(pattern: string, path = "/", glob?: string | null): Promise<GrepResult> {
    const basePath = backendPathToMemoryPath(path ?? "/");
    const files = await this.store.listFiles(basePath);
    const matches = [];
    for (const file of files) {
      if (glob && !globMatches(file, glob)) {
        continue;
      }

      const content = await this.store.read(file);
      const lines = content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.includes(pattern)) {
          matches.push({
            path: `/${file}`,
            line: index + 1,
            text: line,
          });
        }
      }
    }

    return { matches };
  }

  async glob(pattern: string, path = "/"): Promise<GlobResult> {
    const basePath = backendPathToMemoryPath(path);
    const files = await this.store.listFiles(basePath);
    return {
      files: files
        .filter((file) => globMatches(file, pattern))
        .map((file) => ({ path: `/${file}`, is_dir: false })),
    };
  }
}

async function ensureMemoryFile(
  store: FileMemoryStore,
  path: string,
  content: string,
) {
  try {
    await store.read(path);
  } catch {
    await store.write(path, content);
  }
}

async function walkMemoryFiles(directory: string, rootDir: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkMemoryFiles(fullPath, rootDir);
      }

      return [normalizeMemoryPath(fullPath, rootDir, false)];
    }),
  );

  return files.flat().sort();
}

function normalizeInputPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^memories\/+/, "")
    .replace(/^users\/default\/preferences\.md$/, "users/default/preferences.md");
}

function backendPathToMemoryPath(path: string): string {
  const normalized = normalizeInputPath(path);
  if (normalized === "preferences.md") {
    return "users/default/preferences.md";
  }
  if (normalized === "meta-agent-lessons.md") {
    return "agents/meta-agent/lessons.md";
  }
  return normalized;
}

function normalizeMemoryPath(path: string, rootDir: string, isDirectory: boolean): string {
  const relativePath = relative(rootDir, path).replace(/\\/g, "/");
  return isDirectory ? `${relativePath}/` : relativePath;
}

function createMemoryFileData(content: string): FileData {
  const now = new Date().toISOString();
  return {
    content,
    mimeType: "text/markdown",
    created_at: now,
    modified_at: now,
  };
}

function paginateText(content: string, offset: number, limit: number): string {
  if (offset <= 0 && limit <= 0) {
    return content;
  }

  return content.split("\n").slice(Math.max(0, offset), limit > 0 ? offset + limit : undefined).join("\n");
}

function globMatches(file: string, pattern: string): boolean {
  if (pattern === "**/*" || pattern === "*") {
    return true;
  }
  if (pattern.startsWith("**/*.")) {
    return file.endsWith(pattern.slice(4));
  }
  if (pattern.startsWith("*.")) {
    return posix.basename(file).endsWith(pattern.slice(1));
  }
  return file.includes(pattern.replace(/\*/g, ""));
}

function formatMemoryError(error: unknown): string {
  return error instanceof Error ? error.message : "Memory operation failed.";
}
