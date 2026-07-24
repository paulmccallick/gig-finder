import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeStageOrder,
  archiveGroup,
  archiveOutcomeOrder,
  compareRoles,
  filterRoles,
  fitLabels,
  formatPay,
  isOverdue,
  outcomeLabels,
  stageLabels,
  todayInPacific,
  type BoardFilters,
  type BoardMode,
} from "./domain/board";
import { fitRatings, type Job, type JobRole } from "../../core/src/jobs";
import { loadJobs, type JobsResult } from "./data/jobs";
import { loadContacts, type ContactsResult } from "./data/contacts";
import { NetworkingBoard } from "./NetworkingBoard";
import { loadTasks, type TasksResult } from "./data/tasks";
import { TaskBoard } from "./TaskBoard";
import { AgentLauncher, AgentPanel } from "./agent/AgentPanel";

type WorkspaceView = "jobs" | "network" | "tasks";

interface RoleArtifacts {
  jobDescription: string | null;
  sourceUrl: string | null;
  roleDirectory: string | null;
}

const emptyFilters: BoardFilters = {
  search: "",
  stage: "all",
  fit: "all",
  overdueOnly: false,
};

function Icon({ name }: { name: "search" | "calendar" | "close" | "arrow" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m16.2 16.2 4.3 4.3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="m9 18 6-6-6-6" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function RoleCard({ role, onSelect }: { role: JobRole; onSelect: (role: JobRole) => void }) {
  const overdue = isOverdue(role);
  const pay = formatPay(role);
  return (
    <button className="role-card" onClick={() => onSelect(role)} type="button">
      <span className="card-signal" data-fit={role.fit.rating} />
      <span className="card-company">{role.company}</span>
      <span className="card-title">{role.title}</span>
      <span className="card-meta-row">
        <span className="fit-chip" data-fit={role.fit.rating}>{fitLabels[role.fit.rating]}</span>
        {pay && <span className="pay-chip">{pay}</span>}
      </span>
      <span className={`action-line ${overdue ? "is-overdue" : ""}`}>
        <Icon name="calendar" />
        <span>{role.nextAction?.description ?? "No next action"}</span>
      </span>
      <span className="card-footer">
        <span>{overdue ? "OVERDUE" : role.nextAction?.due ?? "NO DEADLINE"}</span>
        <span>ACT {role.lastActivity}</span>
        <Icon name="arrow" />
      </span>
    </button>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return <div className="detail-item"><dt>{label}</dt><dd>{children}</dd></div>;
}

function RoleDrawer({ role, onClose }: { role: JobRole; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [artifacts, setArtifacts] = useState<RoleArtifacts | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setArtifacts(null);
    setArtifactError(null);
    fetch(`/api/jobs/${encodeURIComponent(role.id)}/artifacts`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Artifacts API returned ${response.status}.`);
        return response.json() as Promise<RoleArtifacts>;
      })
      .then((data) => { if (active) setArtifacts(data); })
      .catch((error: unknown) => { if (active) setArtifactError(error instanceof Error ? error.message : "Could not load role artifacts."); });
    return () => { active = false; };
  }, [role.id]);

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" aria-label="Close role details" onClick={onClose} />
      <aside className="role-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Role dossier</span>
            <h2 id="drawer-title">{role.company}</h2>
            <p>{role.title}</p>
          </div>
          <button ref={closeRef} className="icon-button" aria-label="Close role details" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">
          <div className="drawer-badges">
            <span className="stage-chip">{stageLabels[role.stage]}</span>
            <span className="fit-chip" data-fit={role.fit.rating}>{fitLabels[role.fit.rating]}</span>
            {isOverdue(role) && <span className="overdue-chip">Overdue</span>}
          </div>
          <div className="drawer-actions">
            {artifacts?.sourceUrl ? (
              <a className="apply-link" href={artifacts.sourceUrl} target="_blank" rel="noreferrer">Apply / view posting <Icon name="arrow" /></a>
            ) : (
              <span className="application-unavailable">{artifacts ? "No application URL captured" : "Locating application URL…"}</span>
            )}
          </div>
          <section>
            <h3>Current signal</h3>
            <p className="status-narrative">{role.statusSummary}</p>
          </section>
          <dl className="detail-grid">
            <DetailItem label="Last activity">{role.lastActivity}</DetailItem>
            <DetailItem label="Next action">{role.nextAction?.description}</DetailItem>
            <DetailItem label="Action due">{role.nextAction?.due}</DetailItem>
            <DetailItem label="Fit assessment">{role.fit.summary ?? fitLabels[role.fit.rating]}</DetailItem>
            <DetailItem label="Job ID">{role.jobId}</DetailItem>
            <DetailItem label="Role directory"><code>{artifacts?.roleDirectory}</code></DetailItem>
          </dl>
          <section className="description-section">
            <div className="section-heading"><h3>Job description</h3>{artifacts?.jobDescription && <button onClick={() => setDescriptionExpanded((value) => !value)}>{descriptionExpanded ? "Collapse" : "Expand"}</button>}</div>
            {!artifacts && !artifactError && <p className="secondary-copy">Locating the current role files…</p>}
            {artifactError && <p className="artifact-error">{artifactError}</p>}
            {artifacts && !artifacts.jobDescription && <p className="secondary-copy">No captured job description is available for this role.</p>}
            {artifacts?.jobDescription && <pre className={`description-copy ${descriptionExpanded ? "is-expanded" : ""}`}>{artifacts.jobDescription}</pre>}
          </section>
          {role.payRange && (
            <section>
              <h3>Compensation</h3>
              <p className="pay-detail">{formatPay(role)}</p>
              {role.payRange.notes && <p className="secondary-copy">{role.payRange.notes}</p>}
            </section>
          )}
          {role.tags.length > 0 && <div className="tag-list">{role.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        </div>
      </aside>
    </div>
  );
}

function WorkspaceTabs({ active, onChange }: { active: WorkspaceView; onChange: (value: WorkspaceView) => void }) {
  return <nav className="workspace-tabs" aria-label="Workspace"><button aria-current={active === "jobs" ? "page" : undefined} onClick={() => onChange("jobs")}><span>01</span> Opportunities</button><button aria-current={active === "network" ? "page" : undefined} onClick={() => onChange("network")}><span>02</span> Networking</button><button aria-current={active === "tasks" ? "page" : undefined} onClick={() => onChange("tasks")}><span>03</span> Tasks</button></nav>;
}

function Masthead({ today, active, onChange }: { today: string; active: WorkspaceView; onChange: (value: WorkspaceView) => void }) {
  const titles: Record<WorkspaceView, string> = { jobs: "Opportunity Control Room", network: "Relationship Control Room", tasks: "Action Control Room" };
  return <><header className="masthead"><div className="brand-block"><span className="system-mark"><span /> PM</span><div><p className="eyebrow">Search operations / {today}</p><h1>{titles[active]}</h1></div></div><div className="system-status"><span /> DATABASE ONLINE</div></header><WorkspaceTabs active={active} onChange={onChange} /></>;
}

function JobBoard({ roles, onNavigate }: { roles: Job[]; onNavigate: (value: WorkspaceView) => void }) {
  const [mode, setMode] = useState<BoardMode>("active");
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [selectedRole, setSelectedRole] = useState<JobRole | null>(null);
  const today = todayInPacific();
  const activeCount = roles.filter((role) => role.stage !== "closed").length;
  const archiveCount = roles.length - activeCount;
  const overdueCount = roles.filter((role) => isOverdue(role, today)).length;
  const appliedCount = roles.filter((role) => role.stage === "applied").length;

  const visibleRoles = useMemo(
    () => filterRoles(roles, mode, filters, today),
    [roles, mode, filters, today],
  );

  const modeRoles = useMemo(
    () => filterRoles(roles, mode, emptyFilters, today),
    [roles, mode, today],
  );

  const groups = (mode === "active"
    ? activeStageOrder.map((key) => ({
        key,
        label: stageLabels[key],
        roles: visibleRoles.filter((role) => role.stage === key).sort((a, b) => compareRoles(a, b, today)),
        totalRoles: modeRoles.filter((role) => role.stage === key).length,
      }))
    : archiveOutcomeOrder.map((key) => ({
        key,
        label: outcomeLabels[key],
        roles: visibleRoles.filter((role) => archiveGroup(role) === key).sort((a, b) => compareRoles(a, b, today)),
        totalRoles: modeRoles.filter((role) => archiveGroup(role) === key).length,
      }))).filter((group) => group.totalRoles > 0);

  const switchMode = (nextMode: BoardMode) => {
    setMode(nextMode);
    setFilters((current) => ({ ...current, stage: "all", overdueOnly: false }));
  };

  return (
    <main className="app-shell">
      <Masthead today={today} active="jobs" onChange={onNavigate} />

      <section className="metrics pipeline-metrics" aria-label="Pipeline summary">
        <article><span>Active roles</span><strong>{activeCount.toString().padStart(2, "0")}</strong><small>OPEN SIGNALS</small></article>
        <article><span>Applications</span><strong>{appliedCount.toString().padStart(2, "0")}</strong><small>IN MARKET</small></article>
        <article className={overdueCount ? "alert-metric" : ""}><span>Actions overdue</span><strong>{overdueCount.toString().padStart(2, "0")}</strong><small>NEEDS ATTENTION</small></article>
        <article><span>Archived</span><strong>{archiveCount.toString().padStart(2, "0")}</strong><small>HISTORICAL</small></article>
      </section>

      <section className="controls" aria-label="Board controls">
        <div className="view-tabs" role="tablist" aria-label="Role view">
          <button role="tab" aria-selected={mode === "active"} onClick={() => switchMode("active")}>Active <span>{activeCount}</span></button>
          <button role="tab" aria-selected={mode === "archive"} onClick={() => switchMode("archive")}>Archive <span>{archiveCount}</span></button>
        </div>
        <label className="search-control">
          <span className="sr-only">Search roles</span><Icon name="search" />
          <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search company, title, status…" />
        </label>
        {mode === "active" && (
          <label className="select-control">Stage
            <select value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value as BoardFilters["stage"] })}>
              <option value="all">All stages</option>
              {activeStageOrder.map((stage) => <option value={stage} key={stage}>{stageLabels[stage]}</option>)}
            </select>
          </label>
        )}
        <label className="select-control">Fit
          <select value={filters.fit} onChange={(event) => setFilters({ ...filters, fit: event.target.value as BoardFilters["fit"] })}>
            <option value="all">All ratings</option>
            {fitRatings.map((fit) => <option value={fit} key={fit}>{fitLabels[fit]}</option>)}
          </select>
        </label>
        {mode === "active" && <label className="check-control"><input type="checkbox" checked={filters.overdueOnly} onChange={(event) => setFilters({ ...filters, overdueOnly: event.target.checked })} /><span /> Overdue only</label>}
        <button className="clear-button" onClick={() => setFilters(emptyFilters)} disabled={JSON.stringify(filters) === JSON.stringify(emptyFilters)}>Clear</button>
      </section>

      <div className="board-heading">
        <div><span className="eyebrow">{mode === "active" ? "Live pipeline" : "Historical outcomes"}</span><h2>{visibleRoles.length} roles in view</h2></div>
        <p>Cards are ordered by urgency, then activity.</p>
      </div>

      <section className="kanban-board" aria-label={`${mode} job board`}>
        {groups.map((group, index) => (
          <section className="kanban-column" key={group.key} style={{ "--column-index": index } as React.CSSProperties}>
            <header><span className="column-number">{String(index + 1).padStart(2, "0")}</span><h3>{group.label}</h3><span className="column-count">{group.roles.length}</span></header>
            <div className="card-stack">
              {group.roles.map((role) => <RoleCard role={role} onSelect={setSelectedRole} key={role.id} />)}
              {group.roles.length === 0 && <div className="column-empty"><span>NO MATCHES</span><p>{group.totalRoles} {group.totalRoles === 1 ? "role" : "roles"} hidden by filters</p></div>}
            </div>
          </section>
        ))}
      </section>
      {visibleRoles.length === 0 && <div className="filter-empty-notice">No roles match these controls. <button onClick={() => setFilters(emptyFilters)}>Reset filters</button></div>}
      <footer className="app-footer"><span>READ-ONLY MODE</span><span>Source: SQLite</span><span>{roles.length} total records</span></footer>
      {selectedRole && <RoleDrawer role={selectedRole} onClose={() => setSelectedRole(null)} />}
    </main>
  );
}

export function App() {
  const [view, setView] = useState<WorkspaceView>("jobs");
  const [agentOpen, setAgentOpen] = useState(true);
  const [result, setResult] = useState<JobsResult | null>(null);
  const [networkResult, setNetworkResult] = useState<ContactsResult | null>(null);
  const [taskResult, setTaskResult] = useState<TasksResult | null>(null);
  useEffect(() => { void Promise.all([loadJobs().then(setResult), loadContacts().then(setNetworkResult), loadTasks().then(setTaskResult)]); }, []);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [view]);
  if (!result || !networkResult || !taskResult) return <main className="loading-screen"><span /><p>Loading search operations…</p></main>;
  if (!result.ok) return <AppError error={result.error} />;
  if (!networkResult.ok) return <AppError error={networkResult.error} />;
  if (!taskResult.ok) return <AppError error={taskResult.error} />;
  const dashboard = view === "jobs"
    ? <JobBoard roles={result.data} onNavigate={setView} />
    : view === "network"
      ? <main className="app-shell network-shell"><Masthead today={todayInPacific()} active="network" onChange={setView} /><NetworkingBoard contacts={networkResult.data} /></main>
      : <main className="app-shell task-shell"><Masthead today={todayInPacific()} active="tasks" onChange={setView} /><TaskBoard tasks={taskResult.data} /></main>;
  return (
    <>
      <div className={agentOpen ? "dashboard-with-agent" : ""}>{dashboard}</div>
      <AgentLauncher open={agentOpen} onClick={() => setAgentOpen(value => !value)} />
      <div id="job-search-agent">
        <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} />
      </div>
    </>
  );
}

export function AppError({ error }: { error: unknown }) {
  return <main className="fatal-error"><span className="eyebrow">Data fault</span><h1>Dashboard data could not be loaded.</h1><p>{error instanceof Error ? error.message : "An unknown error occurred."}</p><code>Check the local API and SQLite database</code></main>;
}
