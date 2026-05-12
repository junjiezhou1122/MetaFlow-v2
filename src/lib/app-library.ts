import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { MissionArtifact } from "./mission-runtime";

const defaultDataDir = join(process.cwd(), ".metaflow-data");
const appsFilename = "apps.json";

export type SavedApp = {
  id: string;
  title: string;
  sourceMissionId: string;
  sourceMissionInput: string;
  artifacts: MissionArtifact[];
  createdAt: string;
  updatedAt: string;
};

export class FileAppLibrary {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir = defaultDataDir) {
    this.filePath = join(dataDir, appsFilename);
  }

  async list(): Promise<SavedApp[]> {
    const apps = await this.readApps();
    return apps.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string): Promise<SavedApp | null> {
    const apps = await this.readApps();
    return apps.find((app) => app.id === id) ?? null;
  }

  async save(input: {
    title: string;
    sourceMissionId: string;
    sourceMissionInput: string;
    artifacts: MissionArtifact[];
  }): Promise<SavedApp> {
    return this.withWriteLock(async () => {
      const apps = await this.readApps();
      const now = new Date().toISOString();
      const existingIndex = apps.findIndex(
        (app) => app.sourceMissionId === input.sourceMissionId,
      );
      const app: SavedApp = {
        id: existingIndex >= 0 ? apps[existingIndex]!.id : createAppId(),
        title: input.title,
        sourceMissionId: input.sourceMissionId,
        sourceMissionInput: input.sourceMissionInput,
        artifacts: input.artifacts,
        createdAt: existingIndex >= 0 ? apps[existingIndex]!.createdAt : now,
        updatedAt: now,
      };
      const nextApps =
        existingIndex >= 0
          ? apps.map((item, index) => (index === existingIndex ? app : item))
          : [app, ...apps];

      await this.writeApps(nextApps);
      return app;
    });
  }

  private async readApps(): Promise<SavedApp[]> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isSavedApp) : [];
    } catch {
      return [];
    }
  }

  private async writeApps(apps: SavedApp[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(apps, null, 2)}\n`, "utf8");
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function isSavedApp(value: unknown): value is SavedApp {
  if (!value || typeof value !== "object") {
    return false;
  }

  const app = value as Record<string, unknown>;
  return (
    typeof app.id === "string" &&
    typeof app.title === "string" &&
    typeof app.sourceMissionId === "string" &&
    typeof app.sourceMissionInput === "string" &&
    Array.isArray(app.artifacts) &&
    typeof app.createdAt === "string" &&
    typeof app.updatedAt === "string"
  );
}

function createAppId(): string {
  if (typeof randomUUID === "function") {
    return randomUUID();
  }

  return `app-${Date.now()}`;
}
