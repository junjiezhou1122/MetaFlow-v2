"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  formatMissionTimestamp,
  getMissionStatus,
  listMissionHistory,
} from "@/lib/mission-history";
import type { StoredMission } from "@/lib/mission-store";
import type { AgentProfile, MissionArtifact, MissionPreview } from "@/lib/mission-runtime";
import type { MarketAgent } from "@/lib/agent-market";
import {
  defaultBaseUrlFor,
  defaultModelFor,
  defaultProviderSettings,
  type ProviderKind,
  type ProviderSettings,
} from "@/lib/provider-settings";
import type { SavedApp } from "@/lib/app-library";

const settingsStorageKey = "metaflow.provider.settings";

const lanes = [
  { id: "queued", label: "Next" },
  { id: "running", label: "Running" },
  { id: "reviewing", label: "Review" },
  { id: "done", label: "Done" },
];

type ActiveView = "mission" | "mission-space" | "mission-detail" | "library" | "agents" | "settings";
type MissionDetailTab = "run" | "tasks" | "logs";

const navItems: Array<{ id: Exclude<ActiveView, "mission-detail">; label: string }> = [
  { id: "mission", label: "Mission" },
  { id: "mission-space", label: "Mission Space" },
  { id: "library", label: "Library" },
  { id: "agents", label: "Agents" },
  { id: "settings", label: "Settings" },
];

export default function Home() {
  const [activeView, setActiveView] = useState<ActiveView>("mission");
  const [missionDetailTab, setMissionDetailTab] = useState<MissionDetailTab>("run");
  const [missions, setMissions] = useState<StoredMission[]>([]);
  const [apps, setApps] = useState<SavedApp[]>([]);
  const [activeMissionId, setActiveMissionId] = useState("");
  const [activeAppId, setActiveAppId] = useState("");
  const [settings, setSettings] = useState<ProviderSettings>(() => loadStoredSettings());
  const [settingsDraft, setSettingsDraft] = useState<ProviderSettings>(() =>
    loadStoredSettings(),
  );
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [missionDraft, setMissionDraft] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [isFollowingUp, setIsFollowingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [marketAgents, setMarketAgents] = useState<MarketAgent[]>([]);
  const [agentView, setAgentView] = useState<"mine" | "market">("mine");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [agentDraft, setAgentDraft] = useState<AgentProfile | null>(null);
  const [agentSaved, setAgentSaved] = useState(false);
  const [appSaved, setAppSaved] = useState(false);

  const visibleAgents = agents;
  const activeAgent =
    agentDraft ??
    agents.find((agent) => agent.id === selectedAgentId) ??
    agents[0] ??
    null;
  const activeMission =
    missions.find((item) => item.id === activeMissionId) ?? missions[0] ?? null;
  const missionHistory = useMemo(() => listMissionHistory(missions), [missions]);
  const activeApp = apps.find((app) => app.id === activeAppId) ?? apps[0] ?? null;
  const hasRunningMission = missions.some((mission) => mission.status === "running");

  useEffect(() => {
    void refreshMissions();
    void refreshApps();
    void refreshAgents();
    void refreshMarketAgents();
    void refreshSettings();
  }, []);

  useEffect(() => {
    if (!hasRunningMission && activeView !== "mission-space" && activeView !== "mission-detail") {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshMissions();
    }, 1600);

    return () => window.clearInterval(timer);
  }, [activeView, hasRunningMission]);

  async function refreshMissions() {
    try {
      const response = await fetch("/api/missions", { cache: "no-store" });
      const data = (await response.json()) as { missions?: StoredMission[] };
      if (Array.isArray(data.missions)) {
        setMissions(data.missions);
        setActiveMissionId((current) => current || data.missions?.[0]?.id || "");
      }
    } catch {
      setError("Could not load missions.");
    }
  }

  async function refreshAgents() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const data = (await response.json()) as { agents?: AgentProfile[] };
      if (Array.isArray(data.agents)) {
        setAgents(data.agents);
        setSelectedAgentId((current) => current || data.agents?.[0]?.id || "");
      }
    } catch {
      setError("Could not load agent profiles.");
    }
  }

  async function refreshMarketAgents() {
    try {
      const response = await fetch("/api/agent-market", { cache: "no-store" });
      const data = (await response.json()) as { agents?: MarketAgent[] };
      if (Array.isArray(data.agents)) {
        setMarketAgents(data.agents);
      }
    } catch {
      setError("Could not load agency market.");
    }
  }

  async function refreshApps() {
    try {
      const response = await fetch("/api/apps", { cache: "no-store" });
      const data = (await response.json()) as { apps?: SavedApp[] };
      if (Array.isArray(data.apps)) {
        setApps(data.apps);
        setActiveAppId((current) => current || data.apps?.[0]?.id || "");
      }
    } catch {
      setError("Could not load saved apps.");
    }
  }

  async function refreshSettings() {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = (await response.json()) as { settings?: ProviderSettings };
      if (response.ok && data.settings) {
        setSettings(data.settings);
        setSettingsDraft(data.settings);
        window.localStorage.setItem(settingsStorageKey, JSON.stringify(data.settings));
      }
    } catch {
      setSettingsError("Could not load settings.");
    }
  }

  async function submitMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const mission = missionDraft.trim();
    if (!mission) {
      setError("Mission is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission, settings }),
      });
      const data = (await response.json()) as { mission?: StoredMission; error?: string };

      if (!response.ok || !data.mission) {
        setError(data.error || "Mission failed to start.");
        return;
      }

      setMissions((current) => upsertMission(current, data.mission!));
      setActiveMissionId(data.mission.id);
      setMissionDraft("");
      setMissionDetailTab("run");
      setActiveView("mission-space");
      void refreshMissions();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Mission failed to start.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const prompt = followUpDraft.trim();
    if (!prompt || !activeMission) {
      return;
    }

    setIsFollowingUp(true);
    try {
      const response = await fetch(`/api/missions/${activeMission.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, settings }),
      });
      const data = (await response.json()) as { mission?: StoredMission; error?: string };

      if (!response.ok || !data.mission) {
        setError(data.error || "Mission update failed.");
        return;
      }

      setMissions((current) => upsertMission(current, data.mission!));
      setActiveMissionId(data.mission.id);
      setFollowUpDraft("");
      setMissionDetailTab("run");
      setActiveView("mission-detail");
      void refreshMissions();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Mission update failed.");
    } finally {
      setIsFollowingUp(false);
    }
  }

  function createNewMission() {
    setMissionDraft("");
    setError("");
    setActiveView("mission");
  }

  function openMission(missionId: string) {
    setActiveMissionId(missionId);
    setMissionDetailTab("run");
    setActiveView("mission-detail");
  }

  function openApp(appId: string) {
    setActiveAppId(appId);
    setActiveView("library");
  }

  async function saveMissionAsApp() {
    if (!activeMission?.preview?.artifacts?.length) {
      return;
    }

    setError("");
    setAppSaved(false);
    try {
      const response = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: activeMission.id, title: activeMission.title }),
      });
      const data = (await response.json()) as { app?: SavedApp; error?: string };
      if (!response.ok || !data.app) {
        setError(data.error || "Could not save app.");
        return;
      }

      setApps((current) => upsertApp(current, data.app!));
      setActiveAppId(data.app.id);
      setAppSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save app.");
    }
  }

  function updateProvider(provider: ProviderKind) {
    setSettingsDraft((current) => ({
      ...current,
      provider,
      baseUrl: defaultBaseUrlFor(provider),
      model: defaultModelFor(provider),
    }));
    setSettingsSaved(false);
  }

  function updateSettingsDraft(nextSettings: ProviderSettings) {
    setSettingsDraft(nextSettings);
    setSettingsSaved(false);
  }

  async function saveSettings() {
    setSettingsError("");
    setSettingsSaved(false);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: settingsDraft }),
      });
      const data = (await response.json()) as { settings?: ProviderSettings; error?: string };
      if (!response.ok || !data.settings) {
        setSettingsError(data.error || "Could not save settings.");
        return;
      }

      setSettings(data.settings);
      setSettingsDraft(data.settings);
      window.localStorage.setItem(settingsStorageKey, JSON.stringify(data.settings));
      setSettingsSaved(true);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not save settings.");
    }
  }

  function selectAgent(agentId: string) {
    const agent = agents.find((item) => item.id === agentId) ?? null;
    setSelectedAgentId(agentId);
    setAgentDraft(agent);
    setAgentSaved(false);
  }

  function createAgentDraft() {
    const agent: AgentProfile = {
      id: `agent-${Date.now()}`,
      name: "New Agent",
      description: "",
      skills: [],
      taskScope: "",
      successCriteria: [],
      temporary: false,
      createdBy: "system",
    };
    setSelectedAgentId(agent.id);
    setAgentDraft(agent);
    setAgentSaved(false);
  }

  async function saveAgent() {
    if (!agentDraft) {
      return;
    }

    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentDraft),
    });
    const data = (await response.json()) as { agent?: AgentProfile; error?: string };
    if (!response.ok || !data.agent) {
      setError(data.error || "Could not save agent.");
      return;
    }

    setAgents((current) => upsertAgent(current, data.agent!));
    setSelectedAgentId(data.agent.id);
    setAgentDraft(data.agent);
    setAgentSaved(true);
  }

  async function installMarketAgent(marketId: string) {
    const response = await fetch("/api/agent-market/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId }),
    });
    const data = (await response.json()) as { agent?: AgentProfile; error?: string };
    if (!response.ok || !data.agent) {
      setError(data.error || "Could not install agent.");
      return;
    }

    setAgents((current) => upsertAgent(current, data.agent!));
    setSelectedAgentId(data.agent.id);
    setAgentDraft(data.agent);
    setAgentView("mine");
    setAgentSaved(true);
  }

  const visiblePreview = activeMission?.preview ?? createEmptyPreview(activeMission?.input);

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <span>META FLOW</span>
        </div>
        <nav className="navList" aria-label="Workspace sections">
          {navItems.map((item) => (
            <button
              className={
                activeView === item.id ||
                (activeView === "mission-detail" && item.id === "mission-space")
                  ? "navItem active"
                  : "navItem"
              }
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="mainSurface">
        {activeView === "mission" && (
          <MissionView
            error={error}
            isRunning={isSubmitting}
            mission={missionDraft}
            onMissionChange={setMissionDraft}
            onSubmit={submitMission}
          />
        )}

        {activeView === "mission-space" && (
          <MissionSpaceView
            activeMissionId={activeMissionId}
            missions={missionHistory}
            onCreateMission={createNewMission}
            onOpenMission={openMission}
          />
        )}

        {activeView === "mission-detail" && activeMission && (
          <MissionDetailView
            appSaved={appSaved}
            activeTab={missionDetailTab}
            error={error}
            followUp={followUpDraft}
            isFollowingUp={isFollowingUp}
            mission={activeMission}
            preview={visiblePreview}
            onBackToMission={createNewMission}
            onFollowUpChange={setFollowUpDraft}
            onOpenTasks={() => setMissionDetailTab("tasks")}
            onSaveApp={saveMissionAsApp}
            onSelectTab={setMissionDetailTab}
            onSubmitFollowUp={submitFollowUp}
          />
        )}

        {activeView === "library" && (
          <LibraryView
            activeApp={activeApp}
            apps={apps}
            onCreateMission={createNewMission}
            onSelectApp={openApp}
          />
        )}

        {activeView === "agents" && (
          <AgentsView
            agentDraft={agentDraft}
            agentSaved={agentSaved}
            agents={visibleAgents}
            activeAgent={activeAgent}
            agentView={agentView}
            selectedAgentId={selectedAgentId}
            marketAgents={marketAgents}
            onAgentChange={setAgentDraft}
            onCreateAgent={createAgentDraft}
            onInstallMarketAgent={installMarketAgent}
            onSaveAgent={saveAgent}
            onSelectAgent={selectAgent}
            onSelectAgentView={setAgentView}
          />
        )}

        {activeView === "settings" && (
          <SettingsView
            error={settingsError}
            isSaved={settingsSaved}
            settings={settingsDraft}
            onSave={saveSettings}
            onSettingsChange={updateSettingsDraft}
            onUpdateProvider={updateProvider}
          />
        )}
      </section>
    </main>
  );
}

function MissionView(props: {
  error: string;
  isRunning: boolean;
  mission: string;
  onMissionChange: (mission: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="missionCenter">
      <div className="missionHeroCopy">
        <span>META AGENT WORKSPACE</span>
        <h1>Start your mission</h1>
      </div>
      <form className="missionComposer missionOnly" onSubmit={props.onSubmit}>
        <label className="missionInputLabel">
          <textarea
            value={props.mission}
            onChange={(event) => props.onMissionChange(event.target.value)}
            placeholder="Ask, create, or start a mission..."
            rows={3}
            aria-label="Mission"
          />
        </label>
        <div className="missionComposerToolbar">
          <span />
          <button type="submit" disabled={!props.mission.trim() || props.isRunning}>
            {props.isRunning ? "..." : "➜"}
          </button>
        </div>
        {props.error ? <p className="error">{props.error}</p> : null}
      </form>
    </div>
  );
}

function MissionSpaceView(props: {
  activeMissionId: string;
  missions: StoredMission[];
  onCreateMission: () => void;
  onOpenMission: (missionId: string) => void;
}) {
  return (
    <div className="pageStack missionSpace">
      <header className="pageHeader compactHeader missionSpaceHeader">
        <div>
          <p>MISSION SPACE</p>
          <h1>Mission history</h1>
          <span>Open a mission to review its run, task board, and event log.</span>
        </div>
        <button className="secondaryAction" type="button" onClick={props.onCreateMission}>
          New Mission
        </button>
      </header>

      {props.missions.length > 0 ? (
        <section className="missionList" aria-label="Mission history">
          {props.missions.map((mission) => (
            <button
              className={
                mission.id === props.activeMissionId
                  ? "missionListItem active"
                  : "missionListItem"
              }
              key={mission.id}
              onClick={() => props.onOpenMission(mission.id)}
              type="button"
            >
              <span>{mission.status === "running" ? mission.stage : getMissionStatus(mission)}</span>
              <strong>{mission.title}</strong>
              <p>{mission.input || mission.preview?.mission || "Mission detail"}</p>
              <small>{formatMissionTimestamp(mission.updatedAt)}</small>
            </button>
          ))}
        </section>
      ) : (
        <section className="emptyMissionSpace">
          <p>No mission history yet.</p>
          <button className="secondaryAction" type="button" onClick={props.onCreateMission}>
            Start Mission
          </button>
        </section>
      )}
    </div>
  );
}

function MissionDetailView(props: {
  appSaved: boolean;
  activeTab: MissionDetailTab;
  error: string;
  followUp: string;
  isFollowingUp: boolean;
  mission: StoredMission;
  preview: MissionPreview;
  onBackToMission: () => void;
  onFollowUpChange: (value: string) => void;
  onOpenTasks: () => void;
  onSaveApp: () => void | Promise<void>;
  onSelectTab: (tab: MissionDetailTab) => void;
  onSubmitFollowUp: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const tabs: Array<{ id: MissionDetailTab; label: string }> = [
    { id: "run", label: "Run" },
    { id: "tasks", label: "Tasks" },
    { id: "logs", label: "Event Log" },
  ];

  return (
    <div className="missionDetailShell">
      <div className="missionDetailTopbar">
        <div>
          <span>{props.mission.status === "running" ? props.mission.stage : props.mission.status}</span>
          <strong>{props.mission.title}</strong>
        </div>
        <div className="missionDetailTabs" aria-label="Mission detail sections">
          {tabs.map((tab) => (
            <button
              className={props.activeTab === tab.id ? "selected" : ""}
              key={tab.id}
              onClick={() => props.onSelectTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {props.activeTab === "run" && (
        <RunView
          appSaved={props.appSaved}
          error={props.error}
          followUp={props.followUp}
          isFollowingUp={props.isFollowingUp}
          mission={props.mission}
          preview={props.preview}
          onBackToMission={props.onBackToMission}
          onFollowUpChange={props.onFollowUpChange}
          onOpenTasks={props.onOpenTasks}
          onSaveApp={props.onSaveApp}
          onSubmitFollowUp={props.onSubmitFollowUp}
        />
      )}
      {props.activeTab === "tasks" && <TasksView preview={props.preview} />}
      {props.activeTab === "logs" && <LogsView preview={props.preview} />}
    </div>
  );
}

function SettingsView(props: {
  error: string;
  isSaved: boolean;
  settings: ProviderSettings;
  onSave: () => void | Promise<void>;
  onSettingsChange: (settings: ProviderSettings) => void;
  onUpdateProvider: (provider: ProviderKind) => void;
}) {
  return (
    <div className="settingsCenter">
      <section className="settingsPanel">
        <div className="settingsTitle">Settings</div>
        <div className="providerToggle" aria-label="Provider type">
          <button
            className={props.settings.provider === "openai-compatible" ? "selected" : ""}
            type="button"
            onClick={() => props.onUpdateProvider("openai-compatible")}
          >
            OpenAI-compatible
          </button>
          <button
            className={
              props.settings.provider === "anthropic-compatible" ? "selected" : ""
            }
            type="button"
            onClick={() => props.onUpdateProvider("anthropic-compatible")}
          >
            Anthropic-compatible
          </button>
        </div>
        <label>
          Model
          <input
            value={props.settings.model}
            onChange={(event) =>
              props.onSettingsChange({
                ...props.settings,
                model: event.target.value,
              })
            }
            placeholder={defaultModelFor(props.settings.provider)}
            type="text"
          />
        </label>
        <label>
          API key
          <input
            value={props.settings.apiKey}
            onChange={(event) =>
              props.onSettingsChange({
                ...props.settings,
                apiKey: event.target.value,
              })
            }
            placeholder="sk-..."
            type="password"
          />
        </label>
        <label>
          Base URL
          <input
            value={props.settings.baseUrl}
            onChange={(event) =>
              props.onSettingsChange({
                ...props.settings,
                baseUrl: event.target.value,
              })
            }
            placeholder={defaultBaseUrlFor(props.settings.provider)}
            type="url"
          />
        </label>
        <div className="settingsActions">
          <span>{props.error || (props.isSaved ? "Saved" : "")}</span>
          <button type="button" onClick={props.onSave}>
            Save
          </button>
        </div>
      </section>
    </div>
  );
}

function LibraryView(props: {
  activeApp: SavedApp | null;
  apps: SavedApp[];
  onCreateMission: () => void;
  onSelectApp: (appId: string) => void;
}) {
  return (
    <div className="pageStack appLibrary">
      {props.apps.length > 0 ? (
        <div className="libraryGrid">
          <section className="savedAppList" aria-label="Saved apps">
            {props.apps.map((app) => (
              <button
                className={props.activeApp?.id === app.id ? "selected" : ""}
                key={app.id}
                onClick={() => props.onSelectApp(app.id)}
                type="button"
              >
                <strong>{app.title}</strong>
                <span>{app.artifacts.length} files</span>
                <small>{formatMissionTimestamp(app.updatedAt)}</small>
              </button>
            ))}
          </section>

          {props.activeApp ? (
            <section className="focusPanel artifactPanel">
              <div className="artifactList">
                {props.activeApp.artifacts.map((artifact) => (
                  <ArtifactItem
                    artifact={artifact}
                    artifacts={props.activeApp!.artifacts}
                    key={artifact.id}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <section className="emptyMissionSpace">
          <p>No saved apps yet.</p>
          <button className="secondaryAction" type="button" onClick={props.onCreateMission}>
            Start Mission
          </button>
        </section>
      )}
    </div>
  );
}

function AgentsView(props: {
  agentDraft: AgentProfile | null;
  agentSaved: boolean;
  agents: AgentProfile[];
  activeAgent: AgentProfile | null;
  agentView: "mine" | "market";
  marketAgents: MarketAgent[];
  selectedAgentId: string;
  onAgentChange: (agent: AgentProfile) => void;
  onCreateAgent: () => void;
  onInstallMarketAgent: (marketId: string) => void | Promise<void>;
  onSaveAgent: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectAgentView: (view: "mine" | "market") => void;
}) {
  const installedMarketIds = new Set(
    props.agents.map((agent) => agent.marketId).filter(Boolean),
  );

  return (
    <div className="agentsCenter">
      <section className="settingsPanel agentPanel">
        <div className="agentRegistryHeader">
          <div>
            <strong>{props.agentView === "mine" ? "My Agents" : "Agency Market"}</strong>
            <span>
              {props.agentView === "mine"
                ? `${props.agents.length} profiles`
                : `${props.marketAgents.length} templates`}
            </span>
          </div>
          <div className="agentHeaderActions">
            <div className="agentTabs">
              <button
                className={props.agentView === "mine" ? "selected" : ""}
                type="button"
                onClick={() => props.onSelectAgentView("mine")}
              >
                My Agents
              </button>
              <button
                className={props.agentView === "market" ? "selected" : ""}
                type="button"
                onClick={() => props.onSelectAgentView("market")}
              >
                Market
              </button>
            </div>
            {props.agentView === "mine" ? (
              <button className="secondaryAction" type="button" onClick={props.onCreateAgent}>
                New Agent
              </button>
            ) : null}
          </div>
        </div>

        {props.agentView === "mine" ? (
          <div className="agentEditorGrid">
            <div className="agentProfileList">
              {props.agents.map((agent) => (
                <button
                  className={agent.id === props.selectedAgentId ? "selected" : ""}
                  key={agent.id}
                  onClick={() => props.onSelectAgent(agent.id)}
                  type="button"
                >
                  <strong>{agent.name}</strong>
                  <span>{agent.skills.join(" / ") || "No skills yet"}</span>
                </button>
              ))}
            </div>

            {props.activeAgent ? (
              <div className="agentEditor">
                <label>
                  Name
                  <input
                    value={props.activeAgent.name}
                    onChange={(event) =>
                      props.onAgentChange({ ...props.activeAgent!, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={props.activeAgent.description}
                    onChange={(event) =>
                      props.onAgentChange({
                        ...props.activeAgent!,
                        description: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  Skills
                  <input
                    value={props.activeAgent.skills.join(", ")}
                    onChange={(event) =>
                      props.onAgentChange({
                        ...props.activeAgent!,
                        skills: splitList(event.target.value),
                      })
                    }
                    placeholder="planning, building, review"
                  />
                </label>
                <div className="settingsActions">
                  <span>{props.agentSaved ? "Saved" : ""}</span>
                  <button type="button" onClick={props.onSaveAgent}>
                    Save Agent
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="marketAgentGrid">
            {props.marketAgents.map((agent) => {
              const installed = installedMarketIds.has(agent.marketId);
              return (
                <article className="marketAgentCard" key={agent.marketId}>
                  <div>
                    <span>{agent.category}</span>
                    <strong>{agent.name}</strong>
                    <p>{agent.description}</p>
                  </div>
                  <small>{agent.skills.slice(0, 5).join(" / ")}</small>
                  <button
                    type="button"
                    disabled={installed}
                    onClick={() => void props.onInstallMarketAgent(agent.marketId)}
                  >
                    {installed ? "Added" : "Add"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function RunView(props: {
  appSaved: boolean;
  error: string;
  followUp: string;
  isFollowingUp: boolean;
  mission: StoredMission;
  preview: MissionPreview;
  onBackToMission: () => void;
  onFollowUpChange: (value: string) => void;
  onOpenTasks: () => void;
  onSaveApp: () => void | Promise<void>;
  onSubmitFollowUp: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const hasArtifacts = Boolean(props.preview.artifacts?.length);

  return (
    <div className="pageStack">
      {props.mission.status === "failed" ? (
        <section className="focusPanel errorPanel">
          <div className="panelHeader">
            <span>Issue</span>
            <b>{props.mission.stage}</b>
          </div>
          <strong>Mission did not produce a usable artifact.</strong>
          <p>{props.mission.error || props.preview.finalBrief}</p>
        </section>
      ) : null}

      {hasArtifacts ? (
        <section className="focusPanel artifactPanel">
          <div className="artifactRunActions">
            <span>{props.appSaved ? "Saved to Library" : ""}</span>
            <button type="button" onClick={props.onSaveApp}>
              Save App
            </button>
          </div>
          <div className="artifactList">
            {props.preview.artifacts!.map((artifact) => (
              <ArtifactItem
                artifact={artifact}
                artifacts={props.preview.artifacts!}
                key={artifact.id}
              />
            ))}
          </div>
        </section>
      ) : null}

      <form className="followUpComposer" onSubmit={props.onSubmitFollowUp}>
        <textarea
          aria-label="Improve mission"
          onChange={(event) => props.onFollowUpChange(event.target.value)}
          placeholder="Tell Meta Agent what to change next..."
          rows={2}
          value={props.followUp}
        />
        <button
          disabled={
            !props.followUp.trim() ||
            props.isFollowingUp ||
            props.mission.status === "running"
          }
          type="submit"
        >
          {props.isFollowingUp || props.mission.status === "running" ? "..." : "➜"}
        </button>
        {props.error ? <p className="error">{props.error}</p> : null}
      </form>
    </div>
  );
}

function ArtifactItem(props: {
  artifact: MissionArtifact;
  artifacts: MissionArtifact[];
}) {
  const artifactRef = useRef<HTMLElement | null>(null);
  const previewHtml = createPreviewDocument(props.artifact, props.artifacts);
  const [activeView, setActiveView] = useState<"preview" | "code">(
    previewHtml ? "preview" : "code",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sizeLabel = `${(props.artifact.content.length / 1024).toFixed(1)} KB`;

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === artifactRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  async function toggleFullscreen() {
    if (!artifactRef.current) {
      return;
    }

    if (document.fullscreenElement === artifactRef.current) {
      await document.exitFullscreen();
      return;
    }

    setActiveView("preview");
    await artifactRef.current.requestFullscreen();
  }

  return (
    <article className="artifactItem" ref={artifactRef}>
      <div className="artifactMeta">
        <div>
          <strong>{props.artifact.filename}</strong>
          <small>
            {props.artifact.type.toUpperCase()} · {sizeLabel}
          </small>
        </div>
        <div className="artifactActions">
          {previewHtml ? (
            <button
              className={activeView === "preview" ? "selected" : ""}
              type="button"
              onClick={() => setActiveView("preview")}
            >
              Preview
            </button>
          ) : null}
          {previewHtml ? (
            <button type="button" onClick={() => void toggleFullscreen()}>
              {isFullscreen ? "Exit" : "Fullscreen"}
            </button>
          ) : null}
          <button
            className={activeView === "code" ? "selected" : ""}
            type="button"
            onClick={() => setActiveView("code")}
          >
            Code
          </button>
          <button type="button" onClick={() => downloadArtifact(props.artifact)}>
            Download
          </button>
          <button type="button" onClick={() => downloadPackage(props.artifacts)}>
            Package
          </button>
        </div>
      </div>
      {previewHtml && activeView === "preview" ? (
        <iframe
          className="artifactPreview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          srcDoc={previewHtml}
          title={props.artifact.filename}
        />
      ) : null}
      {activeView === "code" ? <pre>{props.artifact.content}</pre> : null}
    </article>
  );
}

function TasksView(props: { preview: MissionPreview }) {
  return (
    <div className="pageStack">
      <section className="boardPanel">
        <div className="panelHeader">
          <span>Tasks</span>
          <b>queued / running / review / done</b>
        </div>
        <div className="taskLanes">
          {lanes.map((lane) => (
            <div className="taskLane" key={lane.id}>
              <h2>{lane.label}</h2>
              {props.preview.tasks
                .filter((task) => task.status === lane.id)
                .map((task) => (
                  <article className="taskCard" key={task.id}>
                    {task.section || task.feature ? (
                      <span className="taskSection">
                        {[task.section, task.feature].filter(Boolean).join(" / ")}
                      </span>
                    ) : null}
                    <strong>{task.title}</strong>
                    <span>{task.assignedTo}</span>
                    <small>{task.description}</small>
                    {task.expectedArtifact ? <small>{task.expectedArtifact}</small> : null}
                    {task.requiredSkills?.length ? (
                      <div className="taskSkillRow">
                        {task.requiredSkills.slice(0, 3).map((skill) => (
                          <em key={skill}>{skill}</em>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LogsView(props: { preview: MissionPreview }) {
  return (
    <div className="pageStack">
      <section className="boardPanel">
        <div className="panelHeader">
          <span>Event Log</span>
          <b>
            {props.preview.events.length} events
            {props.preview.runLogs?.length ? ` / ${props.preview.runLogs.length} logs` : ""}
          </b>
        </div>
        {props.preview.events.length > 0 ? (
          <div className="eventList">
            {props.preview.events.map((event) => (
              <article className="evidenceItem" key={event.id}>
                <strong>{event.type}</strong>
                <span>{event.message}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="emptyState">
            Run a mission to see Meta Agent decisions and assignments.
          </p>
        )}
        {props.preview.runLogs && props.preview.runLogs.length > 0 ? (
          <div className="runLogList">
            {props.preview.runLogs.map((log, index) => (
              <article className="runLogItem" key={`${log.taskId}-${index}`}>
                <strong>{log.agent}</strong>
                <span>{log.taskId}</span>
                <small>{log.level}</small>
                <p>{log.message}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function loadStoredSettings(): ProviderSettings {
  if (typeof window === "undefined") {
    return defaultProviderSettings;
  }

  const stored = window.localStorage.getItem(settingsStorageKey);
  if (!stored) {
    return defaultProviderSettings;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ProviderSettings>;
    const provider =
      parsed.provider === "anthropic-compatible"
        ? "anthropic-compatible"
        : "openai-compatible";

    return {
      provider,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model.trim()
          : defaultModelFor(provider),
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl
          ? parsed.baseUrl
          : defaultBaseUrlFor(provider),
    };
  } catch {
    return defaultProviderSettings;
  }
}

function createEmptyPreview(mission = "Tell MetaFlow what you want to accomplish."): MissionPreview {
  return {
    mission,
    selectedCapabilities: [],
    ephemeralAgents: [],
    tasks: [],
    events: [],
    finalBrief:
      "Meta Agent searches existing capabilities first, creates focused agents only when needed, and keeps the whole run observable.",
  };
}

function upsertMission(missions: StoredMission[], mission: StoredMission): StoredMission[] {
  const exists = missions.some((item) => item.id === mission.id);
  if (!exists) {
    return [mission, ...missions];
  }

  return missions.map((item) => (item.id === mission.id ? mission : item));
}

function upsertAgent(agents: AgentProfile[], agent: AgentProfile): AgentProfile[] {
  const exists = agents.some((item) => item.id === agent.id);
  if (!exists) {
    return [...agents, agent];
  }

  return agents.map((item) => (item.id === agent.id ? agent : item));
}

function upsertApp(apps: SavedApp[], app: SavedApp): SavedApp[] {
  const exists = apps.some((item) => item.id === app.id);
  if (!exists) {
    return [app, ...apps];
  }

  return apps.map((item) => (item.id === app.id ? app : item));
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function downloadArtifact(artifact: MissionArtifact) {
  downloadFile(artifact.filename, artifact.content, contentTypeFor(artifact));
}

function downloadPackage(artifacts: MissionArtifact[]) {
  const zip = createZip(
    artifacts.map((artifact) => ({
      filename: artifact.filename,
      content: artifact.content,
    })),
  );
  downloadBlob("metaflow-artifacts.zip", zip, "application/zip");
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob, type);
}

function downloadBlob(filename: string, blob: Blob, type: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function contentTypeFor(artifact: MissionArtifact): string {
  if (artifact.type === "html") {
    return "text/html";
  }

  if (artifact.type === "css") {
    return "text/css";
  }

  if (artifact.type === "javascript" || artifact.type === "react") {
    return "text/javascript";
  }

  if (artifact.type === "typescript") {
    return "text/typescript";
  }

  if (artifact.type === "json") {
    return "application/json";
  }

  if (artifact.type === "markdown") {
    return "text/markdown";
  }

  return "text/plain";
}

function createPreviewDocument(
  artifact: MissionArtifact,
  artifacts: MissionArtifact[],
): string | null {
  if (artifact.type === "html") {
    return artifact.content;
  }

  const reactEntry =
    artifacts.find((item) => /(^|\/)App\.(jsx|tsx)$/.test(item.filename)) ??
    artifacts.find((item) => item.type === "react");
  if (!reactEntry || artifact.filename !== reactEntry.filename) {
    return null;
  }

  const css = artifacts
    .filter((item) => item.type === "css")
    .map((item) => item.content)
    .join("\n\n");
  const componentSource = normalizeReactComponentSource(reactEntry.content);

  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    "<style>html,body,#root{min-height:100%;margin:0}body{font-family:Inter,system-ui,sans-serif}</style>",
    css ? `<style>${escapeClosingTags(css)}</style>` : "",
    "</head><body><div id=\"root\"></div>",
    '<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>',
    '<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>',
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
    '<script type="text/babel">',
    componentSource,
    "\nconst RootComponent = typeof App !== 'undefined' ? App : window.App;",
    "ReactDOM.createRoot(document.getElementById('root')).render(<RootComponent />);",
    "</script></body></html>",
  ].join("\n");
}

function normalizeReactComponentSource(source: string): string {
  return source
    .replace(/^\s*import\s+.*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/export\s+default\s+function\s+App\s*\(/, "function App(")
    .replace(/export\s+default\s+App\s*;?/g, "")
    .replace(/export\s+default\s+/, "const App = ");
}

function escapeClosingTags(value: string): string {
  return value.replace(/<\/(script|style)>/gi, "<\\/$1>");
}

function createZip(files: Array<{ filename: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.filename);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = createZipHeader({
      signature: 0x04034b50,
      crc,
      compressedSize: data.length,
      uncompressedSize: data.length,
      nameBytes,
    });
    const centralHeader = createZipHeader({
      signature: 0x02014b50,
      crc,
      compressedSize: data.length,
      uncompressedSize: data.length,
      nameBytes,
      offset,
    });

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, end].map(toBlobPart), {
    type: "application/zip",
  });
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function createZipHeader(params: {
  signature: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  nameBytes: Uint8Array;
  offset?: number;
}): Uint8Array {
  const isCentral = params.signature === 0x02014b50;
  const header = new Uint8Array(isCentral ? 46 + params.nameBytes.length : 30 + params.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, params.signature, true);

  if (isCentral) {
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(16, params.crc, true);
    view.setUint32(20, params.compressedSize, true);
    view.setUint32(24, params.uncompressedSize, true);
    view.setUint16(28, params.nameBytes.length, true);
    view.setUint32(42, params.offset ?? 0, true);
    header.set(params.nameBytes, 46);
  } else {
    view.setUint16(4, 20, true);
    view.setUint32(14, params.crc, true);
    view.setUint32(18, params.compressedSize, true);
    view.setUint32(22, params.uncompressedSize, true);
    view.setUint16(26, params.nameBytes.length, true);
    header.set(params.nameBytes, 30);
  }

  return header;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
