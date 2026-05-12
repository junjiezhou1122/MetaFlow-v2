export type MissionStatus = "draft" | "running" | "ready" | "failed" | "stalled";

export type MissionHistoryItem = {
  id: string;
  title?: string;
  input: string;
  preview: unknown | null;
  status?: MissionStatus;
  error?: string;
  createdAt?: string;
  updatedAt: string;
};

export type SubmittedMission<TPreview> = {
  id: string;
  title: string;
  input: string;
  preview: TPreview;
  status: "ready";
  createdAt: string;
  updatedAt: string;
};

export type RunningMission = {
  id: string;
  title: string;
  input: string;
  preview: null;
  status: "running";
  createdAt: string;
  updatedAt: string;
};

export function listMissionHistory<T extends MissionHistoryItem>(missions: T[]): T[] {
  return [...missions]
    .filter((mission) => mission.input.trim() || mission.preview)
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function getMissionStatus(
  mission: Pick<MissionHistoryItem, "preview" | "status"> & Partial<Pick<MissionHistoryItem, "input">>,
): MissionStatus {
  if (
    mission.status === "running" ||
    mission.status === "failed" ||
    mission.status === "stalled"
  ) {
    return mission.status;
  }

  return mission.preview ? "ready" : "draft";
}

export function formatMissionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function createMissionTitle(input: string): string {
  const title = input.trim().replace(/\s+/g, " ");
  if (!title) {
    return "Untitled Mission";
  }

  return title.length > 42 ? `${title.slice(0, 39)}...` : title;
}

export function createSubmittedMission<TPreview>(params: {
  id: string;
  input: string;
  preview: TPreview;
  timestamp: string;
}): SubmittedMission<TPreview> {
  return {
    id: params.id,
    title: createMissionTitle(params.input),
    input: params.input,
    preview: params.preview,
    status: "ready",
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };
}

export function createRunningMission(params: {
  id: string;
  input: string;
  timestamp: string;
}): RunningMission {
  return {
    id: params.id,
    title: createMissionTitle(params.input),
    input: params.input,
    preview: null,
    status: "running",
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };
}
