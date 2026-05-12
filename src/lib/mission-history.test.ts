import { describe, expect, it } from "vitest";

import {
  createRunningMission,
  createMissionTitle,
  createSubmittedMission,
  formatMissionTimestamp,
  getMissionStatus,
  listMissionHistory,
} from "./mission-history";

describe("mission history", () => {
  it("keeps meaningful missions newest first and skips blank drafts", () => {
    const missions = [
      {
        id: "blank",
        title: "Untitled Mission",
        input: "   ",
        preview: null,
        createdAt: "2026-05-10T08:00:00.000Z",
        updatedAt: "2026-05-10T08:00:00.000Z",
      },
      {
        id: "older",
        title: "Older mission",
        input: "Research competitors",
        preview: null,
        createdAt: "2026-05-10T09:00:00.000Z",
        updatedAt: "2026-05-10T09:00:00.000Z",
      },
      {
        id: "newer",
        title: "Newer mission",
        input: "",
        preview: { mission: "Create a launch plan" },
        createdAt: "2026-05-10T10:00:00.000Z",
        updatedAt: "2026-05-10T10:00:00.000Z",
      },
    ];

    expect(listMissionHistory(missions).map((mission) => mission.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("labels running, completed, failed, and text-only missions", () => {
    expect(getMissionStatus({ input: "Plan launch", preview: null, status: "running" })).toBe(
      "running",
    );
    expect(getMissionStatus({ input: "Plan launch", preview: null, status: "failed" })).toBe(
      "failed",
    );
    expect(getMissionStatus({ input: "Plan launch", preview: null, status: "stalled" })).toBe(
      "stalled",
    );
    expect(getMissionStatus({ input: "Plan launch", preview: null })).toBe("draft");
    expect(getMissionStatus({ input: "Plan launch", preview: {} })).toBe("ready");
  });

  it("formats valid timestamps and falls back for invalid values", () => {
    expect(formatMissionTimestamp("not-a-date")).toBe("Unknown time");
    expect(formatMissionTimestamp("2026-05-10T10:00:00.000Z")).not.toBe(
      "Unknown time",
    );
  });

  it("creates a separate record for each submitted mission", () => {
    const first = createSubmittedMission({
      id: "first",
      input: "Research the agent market",
      preview: { mission: "Research the agent market" },
      timestamp: "2026-05-10T10:00:00.000Z",
    });
    const second = createSubmittedMission({
      id: "second",
      input: "Plan a launch campaign",
      preview: { mission: "Plan a launch campaign" },
      timestamp: "2026-05-10T11:00:00.000Z",
    });

    expect(first.id).not.toBe(second.id);
    expect([first, second].map((mission) => mission.title)).toEqual([
      "Research the agent market",
      "Plan a launch campaign",
    ]);
  });

  it("creates a running mission before the agent backend returns", () => {
    const mission = createRunningMission({
      id: "mission-1",
      input: "Create a todolist web app",
      timestamp: "2026-05-10T10:00:00.000Z",
    });

    expect(mission).toMatchObject({
      id: "mission-1",
      title: "Create a todolist web app",
      input: "Create a todolist web app",
      preview: null,
      status: "running",
    });
  });

  it("creates concise mission titles from long input", () => {
    expect(createMissionTitle("   ")).toBe("Untitled Mission");
    expect(createMissionTitle("a".repeat(60))).toBe(`${"a".repeat(39)}...`);
  });
});
