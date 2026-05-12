import { FileAppLibrary } from "./app-library";
import { FileAgentRegistry } from "./agent-registry";
import {
  FileMissionStore,
  appendMissionEvent,
  type StoredMission,
} from "./mission-store";
import {
  buildMissionPreview,
  runMissionIteration,
  runMultiAgentMission,
} from "./mission-runtime";
import { createChatModel } from "./model-factory";
import { createSkillLibraryAgent, loadWorkspaceSkills } from "./skill-registry";
import { FileSettingsStore } from "./settings-store";
import {
  normalizeProviderSettings,
  sanitizeProviderSettings,
  type ProviderSettings,
} from "./provider-settings";

const runningMissionIds = new Set<string>();
const stalledAfterMs = 10 * 60 * 1000;
const watchdogIntervalMs = 30 * 1000;

export const missionStore = new FileMissionStore();
export const agentRegistry = new FileAgentRegistry();
export const settingsStore = new FileSettingsStore();
export const appLibrary = new FileAppLibrary();

export async function startMissionExecution(
  mission: StoredMission,
  settingsInput: unknown,
): Promise<void> {
  if (runningMissionIds.has(mission.id)) {
    return;
  }

  runningMissionIds.add(mission.id);
  void executeMission(mission, settingsInput).finally(() => {
    runningMissionIds.delete(mission.id);
  });
}

export async function startMissionIteration(
  mission: StoredMission,
  prompt: string,
  settingsInput: unknown,
): Promise<void> {
  if (runningMissionIds.has(mission.id)) {
    return;
  }

  runningMissionIds.add(mission.id);
  void executeMissionIteration(mission, prompt, settingsInput).finally(() => {
    runningMissionIds.delete(mission.id);
  });
}

async function executeMission(mission: StoredMission, settingsInput: unknown) {
  const stopWatchdog = startStallWatchdog(mission.id);
  const storedSettings =
    settingsInput && typeof settingsInput === "object"
      ? null
      : await settingsStore.load();
  const settingsSource = storedSettings ?? settingsInput;
  const rawSettings =
    settingsSource && typeof settingsSource === "object"
      ? normalizeProviderSettings(settingsSource as Partial<ProviderSettings>)
      : normalizeProviderSettings(null);
  const safeSettings =
    settingsSource && typeof settingsSource === "object"
      ? sanitizeProviderSettings(settingsSource as Partial<ProviderSettings>)
      : sanitizeProviderSettings(null);
  const model = createChatModel(rawSettings);
  const agents = await loadRuntimeAgents(mission.input);

  try {
    await missionStore.update(mission.id, {
      status: "running",
      stage: "planning",
      error: undefined,
    });

    const preview = await runMultiAgentMission(
      mission.input,
      safeSettings,
      model,
      agents,
      async (update) => {
        await missionStore.update(mission.id, {
          status: "running",
          stage: update.stage,
          preview: update.preview,
        });
      },
    );

    await missionStore.update(mission.id, {
      status: preview.error ? "failed" : "ready",
      stage: preview.error ? "failed" : "done",
      preview,
      error: preview.error,
    });
  } catch (error) {
    const latestMission = (await missionStore.get(mission.id)) ?? mission;
    const basePreview = latestMission.preview ?? buildMissionPreview(latestMission.input);
    const message =
      error instanceof Error ? error.message : "Mission execution failed.";
    await missionStore.update(mission.id, {
      status: "failed",
      stage: "failed",
      preview: appendMissionEvent(basePreview, "mission.failed", message),
      error: message,
    });
  } finally {
    stopWatchdog();
  }
}

async function executeMissionIteration(
  mission: StoredMission,
  prompt: string,
  settingsInput: unknown,
) {
  const stopWatchdog = startStallWatchdog(mission.id);
  const storedSettings =
    settingsInput && typeof settingsInput === "object"
      ? null
      : await settingsStore.load();
  const settingsSource = storedSettings ?? settingsInput;
  const rawSettings =
    settingsSource && typeof settingsSource === "object"
      ? normalizeProviderSettings(settingsSource as Partial<ProviderSettings>)
      : normalizeProviderSettings(null);
  const safeSettings =
    settingsSource && typeof settingsSource === "object"
      ? sanitizeProviderSettings(settingsSource as Partial<ProviderSettings>)
      : sanitizeProviderSettings(null);
  const model = createChatModel(rawSettings);
  const agents = await loadRuntimeAgents([mission.input, prompt].join("\n"));

  try {
    await missionStore.update(mission.id, {
      status: "running",
      stage: "planning",
      error: undefined,
    });

    const latestMission = (await missionStore.get(mission.id)) ?? mission;
    const preview = await runMissionIteration(
      latestMission.input,
      prompt,
      latestMission.preview,
      safeSettings,
      model,
      agents,
      async (update) => {
        await missionStore.update(mission.id, {
          status: "running",
          stage: update.stage,
          preview: update.preview,
        });
      },
    );

    await missionStore.update(mission.id, {
      status: preview.error ? "failed" : "ready",
      stage: preview.error ? "failed" : "done",
      preview,
      error: preview.error,
    });
  } catch (error) {
    const latestMission = (await missionStore.get(mission.id)) ?? mission;
    const basePreview = latestMission.preview ?? buildMissionPreview(latestMission.input);
    const message = error instanceof Error ? error.message : "Mission update failed.";
    await missionStore.update(mission.id, {
      status: "failed",
      stage: "failed",
      preview: appendMissionEvent(basePreview, "mission.failed", message),
      error: message,
    });
  } finally {
    stopWatchdog();
  }
}

async function loadRuntimeAgents(query: string) {
  const agents = await agentRegistry.list();
  const skillLibraryAgent = createSkillLibraryAgent(await loadWorkspaceSkills(undefined, query));
  return skillLibraryAgent ? [...agents, skillLibraryAgent] : agents;
}

function startStallWatchdog(missionId: string): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    void markMissionStalledIfIdle(missionId);
  }, watchdogIntervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };

  async function markMissionStalledIfIdle(id: string) {
    if (stopped) {
      return;
    }

    const mission = await missionStore.get(id);
    if (!mission || mission.status !== "running") {
      return;
    }

    const lastUpdate = new Date(mission.updatedAt).getTime();
    if (!Number.isFinite(lastUpdate) || Date.now() - lastUpdate < stalledAfterMs) {
      return;
    }

    await missionStore.update(id, {
      status: "stalled",
      stage: "stalled",
      error:
        "No progress has been observed for a while. The model call may still be pending; you can retry or continue the mission.",
    });
    runningMissionIds.delete(id);
  }
}
