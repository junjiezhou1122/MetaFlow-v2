import { describe, expect, it } from "vitest";

import { getMarketAgent, installMarketAgent, listMarketAgents } from "./agent-market";

describe("agent market", () => {
  it("converts agency agent templates into MetaFlow market agents", () => {
    const agents = listMarketAgents();

    expect(agents.length).toBeGreaterThanOrEqual(12);
    expect(agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(["Frontend Developer", "UI Designer", "Product Manager"]),
    );
    expect(agents[0]).toMatchObject({
      source: "market",
      license: "MIT",
    });
    expect(agents[0]?.originUrl).toContain("github.com/msitarzewski/agency-agents");
    expect(agents[0]?.skills.length).toBeGreaterThan(0);
    expect(agents[0]?.instructions).toContain("#");
    expect(agents[0]?.skillDetails?.[0]).toMatchObject({
      source: "market",
      trustLevel: "markdown_only",
    });
    expect(agents[0]?.skillDetails).toHaveLength(1);
    expect(agents[0]?.skillDetails?.[0]?.markdown).toContain("Imported directly");
    expect(agents[0]?.skillDetails?.[0]?.markdown).toContain("Core Mission");
  });

  it("installs a market agent as a registry profile", () => {
    const market = getMarketAgent("engineering-engineering-frontend-developer");
    const installed = installMarketAgent("engineering-engineering-frontend-developer");

    expect(market?.name).toBe("Frontend Developer");
    expect(installed).toMatchObject({
      id: "market-engineering-engineering-frontend-developer",
      name: "Frontend Developer",
      source: "market",
      marketId: "engineering-engineering-frontend-developer",
      createdBy: "system",
      temporary: false,
    });
    expect(installed?.installedAt).toBeTruthy();
    expect(installed?.skillIds?.length).toBeGreaterThan(0);
    expect(installed?.skillDetails?.[0]?.markdown).toContain("Frontend Developer");
    expect(installed?.instructions).toContain("Frontend Developer Agent Personality");
  });
});
