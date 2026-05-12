import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createMissionTitle, listMissionHistory, type MissionStatus } from "./mission-history";
import type { MissionEvent, MissionPreview } from "./mission-runtime";

const defaultDataDir = join(process.cwd(), ".metaflow-data");
const missionsFilename = "missions.json";

export type MissionStage =
  | "queued"
  | "planning"
  | "building"
  | "reviewing"
  | "repairing"
  | "stalled"
  | "done"
  | "failed";

export type StoredMission = {
  id: string;
  title: string;
  input: string;
  preview: MissionPreview | null;
  status: MissionStatus;
  stage: MissionStage;
  error?: string;
  createdAt: string;
  updatedAt: string;
  runningSince?: string;
  activeRunId?: string;
};

export type MissionUpdate = Partial<
  Pick<
    StoredMission,
    "preview" | "status" | "stage" | "error" | "runningSince" | "activeRunId"
  >
>;

export function appendMissionEvent(
  preview: MissionPreview,
  type: MissionEvent["type"],
  message: string,
): MissionPreview {
  const events = preview.events ?? [];
  return {
    ...preview,
    events: [
      ...events,
      {
        id: `event-${events.length + 1}`,
        type,
        message,
      },
    ],
  };
}

export class FileMissionStore {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir = defaultDataDir) {
    this.filePath = join(dataDir, missionsFilename);
  }

  async list(): Promise<StoredMission[]> {
    const missions = await this.readMissions();
    return listMissionHistory(missions);
  }

  async get(id: string): Promise<StoredMission | null> {
    const missions = await this.readMissions();
    return missions.find((mission) => mission.id === id) ?? null;
  }

  async create(input: string): Promise<StoredMission> {
    return this.withWriteLock(async () => {
      const missions = await this.readMissions();
      const now = new Date().toISOString();
      const mission: StoredMission = {
        id: createMissionId(),
        title: createMissionTitle(input),
        input,
        preview: null,
        status: "running",
        stage: "queued",
        createdAt: now,
        updatedAt: now,
      };

      await this.writeMissions([mission, ...missions]);
      return mission;
    });
  }

  async update(id: string, update: MissionUpdate): Promise<StoredMission | null> {
    return this.withWriteLock(async () => {
      const missions = await this.readMissions();
      let updatedMission: StoredMission | null = null;
      const nextMissions = missions.map((mission) => {
        if (mission.id !== id) {
          return mission;
        }

        updatedMission = {
          ...mission,
          ...update,
          updatedAt: new Date().toISOString(),
        };
        return updatedMission;
      });

      if (!updatedMission) {
        return null;
      }

      await this.writeMissions(nextMissions);
      return updatedMission;
    });
  }

  async updateIfRunActive(
    id: string,
    runId: string,
    update: MissionUpdate,
  ): Promise<StoredMission | null> {
    return this.withWriteLock(async () => {
      const missions = await this.readMissions();
      let updatedMission: StoredMission | null = null;
      const nextMissions = missions.map((mission) => {
        if (mission.id !== id) {
          return mission;
        }

        if (mission.activeRunId !== runId) {
          return mission;
        }

        updatedMission = {
          ...mission,
          ...update,
          updatedAt: new Date().toISOString(),
        };
        return updatedMission;
      });

      if (!updatedMission) {
        return null;
      }

      await this.writeMissions(nextMissions);
      return updatedMission;
    });
  }

  private async readMissions(): Promise<StoredMission[]> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter(isStoredMission).map(normalizeStoredMission)
        : [];
    } catch {
      return [];
    }
  }

  private async writeMissions(missions: StoredMission[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(missions, null, 2)}\n`, "utf8");
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function normalizeStoredMission(mission: StoredMission): StoredMission {
  const preview = mission.preview;
  const artifacts = preview?.artifacts;
  if (!preview || !artifacts) {
    return mission;
  }

  const visibleArtifacts = artifacts.filter(
    (artifact) => !isOrchestrationArtifact(artifact.filename),
  );

  if (visibleArtifacts.length === artifacts.length) {
    return mission;
  }

  const normalizedPreview = {
    ...preview,
    artifacts: visibleArtifacts,
    finalBrief:
      visibleArtifacts.length > 0
        ? preview.finalBrief
        : "This run only produced internal orchestration metadata, not a usable artifact.",
  };

  if (visibleArtifacts.length > 0) {
    return {
      ...mission,
      preview: normalizedPreview,
    };
  }

  return {
    ...mission,
    preview: normalizedPreview,
    status: "failed",
    stage: "failed",
    error: "Mission produced only internal orchestration metadata, not a usable artifact.",
  };
}

function isOrchestrationArtifact(filename: string): boolean {
  return [
    "mission-run.json",
    "planner-output.json",
    "review.json",
  ].includes(filename);
}

function isStoredMission(value: unknown): value is StoredMission {
  if (!value || typeof value !== "object") {
    return false;
  }

  const mission = value as Record<string, unknown>;
  return (
    typeof mission.id === "string" &&
    typeof mission.title === "string" &&
    typeof mission.input === "string" &&
    (mission.preview === null || typeof mission.preview === "object") &&
    isMissionStatus(mission.status) &&
    isMissionStage(mission.stage) &&
    typeof mission.createdAt === "string" &&
    typeof mission.updatedAt === "string" &&
    (mission.runningSince === undefined || typeof mission.runningSince === "string") &&
    (mission.activeRunId === undefined || typeof mission.activeRunId === "string") &&
    (mission.error === undefined || typeof mission.error === "string")
  );
}

function isMissionStatus(value: unknown): value is MissionStatus {
  return (
    value === "draft" ||
    value === "running" ||
    value === "ready" ||
    value === "stalled" ||
    value === "failed"
  );
}

function isMissionStage(value: unknown): value is MissionStage {
  return (
    value === "queued" ||
    value === "planning" ||
    value === "building" ||
    value === "reviewing" ||
    value === "repairing" ||
    value === "stalled" ||
    value === "done" ||
    value === "failed"
  );
}

function createMissionId(): string {
  if (typeof randomUUID === "function") {
    return randomUUID();
  }

  return `mission-${Date.now()}`;
}
