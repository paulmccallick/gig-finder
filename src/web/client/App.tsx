import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  activeStageOrder,
  archiveGroup,
  archiveOutcomeOrder,
  compareGigs,
  filterGigs,
  fitLabels,
  formatPay,
  isOverdue,
  outcomeLabels,
  stageLabels,
  todayInPacific,
  type BoardFilters,
  type BoardMode,
} from "./domain/board";
import { fitRatings, type GigRecord, type GigSummary } from "../../core/gigs";
import { loadGigs, type GigsResult } from "./data/gigs";
import { loadPeople, type PeopleResult } from "./data/people";
import { NetworkingBoard } from "./NetworkingBoard";
import { loadTasks, type TasksResult } from "./data/tasks";
import { TaskBoard } from "./TaskBoard";
import { AgentLauncher, AgentPanel } from "./agent/AgentPanel";
import { GigScoutPage } from "./GigScoutPage";
import {
  defaultAgentPanelWidth,
  initialAgentWorkspace,
  updateAgentWorkspace,
} from "./agent/agent-workspace";
import {
  loadedManagedDocumentForLocation,
  loadManagedDocumentVersion,
  type LoadedManagedDocument,
} from "./data/documents";
import { MarkdownRenderer } from "./MarkdownRenderer";

type WorkspaceView = "gigs" | "network" | "tasks" | "scout";

export function initialWorkspaceView(search: string): WorkspaceView {
  return new URLSearchParams(search).get("workspace") === "scout"
    ? "scout"
    : "gigs";
}

const emptyFilters: BoardFilters = {
  search: "",
  stage: "all",
  fit: "all",
  overdueOnly: false,
};

function Icon({ name }: { name: "search" | "close" | "arrow" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m16.2 16.2 4.3 4.3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="m9 18 6-6-6-6" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function GigCard({ gig, onSelect }: { gig: GigSummary; onSelect: (gigId: string) => void }) {
  const overdue = isOverdue(gig);
  const pay = formatPay(gig);
  return (
    <button className="record-card" onClick={() => onSelect(gig.id)} type="button">
      <span className="card-signal" data-fit={gig.fit.rating} />
      <span className="card-company">{gig.company}</span>
      <span className="card-title">{gig.title}</span>
      <span className="card-meta-row">
        <span className="fit-chip" data-fit={gig.fit.rating}>{fitLabels[gig.fit.rating]}</span>
        {pay && <span className="pay-chip">{pay}</span>}
      </span>
      <span className={`card-footer ${overdue ? "is-overdue" : ""}`}>
        <span>{overdue ? "OVERDUE" : gig.nextAction?.due ?? "NO DEADLINE"}</span>
        <span>ACT {gig.lastActivity}</span>
        <Icon name="arrow" />
      </span>
    </button>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return <div className="detail-item"><dt>{label}</dt><dd>{children}</dd></div>;
}

function GigDrawer({ gig, onClose }: { gig: GigRecord; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loadedManagedDocument, setLoadedManagedDocument] = useState<LoadedManagedDocument | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const description = gig.documents
    .filter(candidate => candidate.type === "job_description")
    .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
  const descriptionLocation = description
    ? { reference: description.id, version: description.currentVersion }
    : null;
  const managedDocument = loadedManagedDocumentForLocation(
    loadedManagedDocument,
    descriptionLocation,
  );
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
    setLoadedManagedDocument(null);
    setDocumentError(null);
    setDescriptionExpanded(false);
    if (!descriptionLocation) return () => { active = false; };
    const location = descriptionLocation;
    void loadManagedDocumentVersion(location)
      .then(document => { if (active) setLoadedManagedDocument({ location, document }); })
      .catch((error: unknown) => { if (active) setDocumentError(error instanceof Error ? error.message : "Could not load the job description."); });
    return () => { active = false; };
  }, [gig.id, description?.id, description?.currentVersion]);

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" aria-label="Close gig details" onClick={onClose} />
      <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Gig dossier</span>
            <h2 id="drawer-title">{gig.company}</h2>
            <p>{gig.title}</p>
          </div>
          <button ref={closeRef} className="icon-button" aria-label="Close gig details" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">
          <div className="drawer-badges">
            <span className="stage-chip">{stageLabels[gig.stage]}</span>
            <span className="fit-chip" data-fit={gig.fit.rating}>{fitLabels[gig.fit.rating]}</span>
            {isOverdue(gig) && <span className="overdue-chip">Overdue</span>}
          </div>
          <div className="drawer-actions">
            {gig.sourceUrl ? (
              <a className="apply-link" href={gig.sourceUrl} target="_blank" rel="noreferrer">Apply / view posting <Icon name="arrow" /></a>
            ) : (
              <span className="application-unavailable">No application URL captured</span>
            )}
          </div>
          <section>
            <h3>Current signal</h3>
            <p className="status-narrative">{gig.statusSummary}</p>
          </section>
          <dl className="detail-grid">
            <DetailItem label="Last activity">{gig.lastActivity}</DetailItem>
            <DetailItem label="Next action">{gig.nextAction?.description}</DetailItem>
            <DetailItem label="Action due">{gig.nextAction?.due}</DetailItem>
            <DetailItem label="Fit assessment">{gig.fit.summary ?? fitLabels[gig.fit.rating]}</DetailItem>
            <DetailItem label="External job ID">{gig.externalJobId}</DetailItem>
          </dl>
          <section className="description-section">
            <div className="section-heading">
              <h3>Job description</h3>
              {managedDocument && <button onClick={() => setDescriptionExpanded(value => !value)}>{descriptionExpanded ? "Collapse" : "Expand"}</button>}
            </div>
            {descriptionLocation && !managedDocument && !documentError && <p className="secondary-copy">Loading the current job description…</p>}
            {documentError && <p className="artifact-error">{documentError}</p>}
            {!descriptionLocation && <p className="secondary-copy">No managed job description is available for this gig.</p>}
            {descriptionLocation && managedDocument && <>
              <a href={`/documents/${encodeURIComponent(descriptionLocation.reference)}/versions/${descriptionLocation.version}`} target="_blank" rel="noreferrer">Open document</a>
              <div className={`description-copy ${descriptionExpanded ? "is-expanded" : ""}`}><MarkdownRenderer>{managedDocument.content}</MarkdownRenderer></div>
            </>}
          </section>
          {gig.payRange && (
            <section>
              <h3>Compensation</h3>
              <p className="pay-detail">{formatPay(gig)}</p>
              {gig.payRange.notes && <p className="secondary-copy">{gig.payRange.notes}</p>}
            </section>
          )}
          {gig.tags.length > 0 && <div className="tag-list">{gig.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        </div>
      </aside>
    </div>
  );
}

function WorkspaceTabs({ active, onChange }: { active: WorkspaceView; onChange: (value: WorkspaceView) => void }) {
  return <nav className="workspace-tabs" aria-label="Workspace"><button aria-current={active === "gigs" ? "page" : undefined} onClick={() => onChange("gigs")}><span>01</span> Opportunities</button><button aria-current={active === "network" ? "page" : undefined} onClick={() => onChange("network")}><span>02</span> Networking</button><button aria-current={active === "tasks" ? "page" : undefined} onClick={() => onChange("tasks")}><span>03</span> Tasks</button><button aria-current={active === "scout" ? "page" : undefined} onClick={() => onChange("scout")}><span>04</span> Gig Scout</button></nav>;
}

function Masthead({ today, active, onChange }: { today: string; active: WorkspaceView; onChange: (value: WorkspaceView) => void }) {
  const titles: Record<WorkspaceView, string> = { gigs: "Opportunity Control Room", network: "Relationship Control Room", tasks: "Action Control Room", scout:"Gig Scout Control Room" };
  return <><header className="masthead"><div className="brand-block"><span className="system-mark"><span /> PM</span><div><p className="eyebrow">Search operations / {today}</p><h1>{titles[active]}</h1></div></div><div className="system-status"><span /> DATABASE ONLINE</div></header><WorkspaceTabs active={active} onChange={onChange} /></>;
}

function GigBoard({ gigs, onNavigate }: { gigs: GigRecord[]; onNavigate: (value: WorkspaceView) => void }) {
  const [mode, setMode] = useState<BoardMode>("active");
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [selectedGig, setSelectedGig] = useState<GigRecord | null>(null);
  useEffect(() => {
    if (!selectedGig) return;
    setSelectedGig(gigs.find(gig => gig.id === selectedGig.id) ?? null);
  }, [gigs, selectedGig?.id]);
  const today = todayInPacific();
  const activeCount = gigs.filter((gig) => gig.stage !== "closed").length;
  const archiveCount = gigs.length - activeCount;
  const overdueCount = gigs.filter((gig) => isOverdue(gig, today)).length;
  const appliedCount = gigs.filter((gig) => gig.stage === "applied").length;

  const visibleGigs = useMemo(
    () => filterGigs(gigs, mode, filters, today),
    [gigs, mode, filters, today],
  );

  const modeGigs = useMemo(
    () => filterGigs(gigs, mode, emptyFilters, today),
    [gigs, mode, today],
  );

  const groups = (mode === "active"
    ? activeStageOrder.map((key) => ({
        key,
        label: stageLabels[key],
        gigs: visibleGigs.filter((gig) => gig.stage === key).sort((a, b) => compareGigs(a, b, today)),
        totalGigs: modeGigs.filter((gig) => gig.stage === key).length,
      }))
    : archiveOutcomeOrder.map((key) => ({
        key,
        label: outcomeLabels[key],
        gigs: visibleGigs.filter((gig) => archiveGroup(gig) === key).sort((a, b) => compareGigs(a, b, today)),
        totalGigs: modeGigs.filter((gig) => archiveGroup(gig) === key).length,
      }))).filter((group) => group.totalGigs > 0);

  const switchMode = (nextMode: BoardMode) => {
    setMode(nextMode);
    setFilters((current) => ({ ...current, stage: "all", overdueOnly: false }));
  };

  return (
    <main className="app-shell">
      <Masthead today={today} active="gigs" onChange={onNavigate} />

      <section className="metrics pipeline-metrics" aria-label="Pipeline summary">
        <article><span>Active gigs</span><strong>{activeCount.toString().padStart(2, "0")}</strong><small>OPEN SIGNALS</small></article>
        <article><span>Applications</span><strong>{appliedCount.toString().padStart(2, "0")}</strong><small>IN MARKET</small></article>
        <article className={overdueCount ? "alert-metric" : ""}><span>Actions overdue</span><strong>{overdueCount.toString().padStart(2, "0")}</strong><small>NEEDS ATTENTION</small></article>
        <article><span>Archived</span><strong>{archiveCount.toString().padStart(2, "0")}</strong><small>HISTORICAL</small></article>
      </section>

      <section className="controls" aria-label="Board controls">
        <div className="view-tabs" role="tablist" aria-label="Gig view">
          <button role="tab" aria-selected={mode === "active"} onClick={() => switchMode("active")}>Active <span>{activeCount}</span></button>
          <button role="tab" aria-selected={mode === "archive"} onClick={() => switchMode("archive")}>Archive <span>{archiveCount}</span></button>
        </div>
        <label className="search-control">
          <span className="sr-only">Search gigs</span><Icon name="search" />
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

      <section className="kanban-board" aria-label={`${mode} gig board`}>
        {groups.map((group, index) => (
          <section className="kanban-column" key={group.key} style={{ "--column-index": index } as React.CSSProperties}>
            <header><span className="column-number">{String(index + 1).padStart(2, "0")}</span><h3>{group.label}</h3><span className="column-count">{group.gigs.length}</span></header>
            <div className="card-stack">
              {group.gigs.map((gig) => <GigCard gig={gig} onSelect={(gigId) => setSelectedGig(gigs.find(candidate => candidate.id === gigId) ?? null)} key={gig.id} />)}
              {group.gigs.length === 0 && <div className="column-empty"><span>NO MATCHES</span><p>{group.totalGigs} {group.totalGigs === 1 ? "gig" : "gigs"} hidden by filters</p></div>}
            </div>
          </section>
        ))}
      </section>
      {visibleGigs.length === 0 && <div className="filter-empty-notice">No gigs match these controls. <button onClick={() => setFilters(emptyFilters)}>Reset filters</button></div>}
      <footer className="app-footer"><span>READ-ONLY MODE</span><span>Source: SQLite</span><span>{gigs.length} total records</span></footer>
      {selectedGig && <GigDrawer gig={selectedGig} onClose={() => setSelectedGig(null)} />}
    </main>
  );
}

export function App() {
  const [view, setView] = useState<WorkspaceView>(() => initialWorkspaceView(window.location.search));
  const [agentWorkspace, dispatchAgentWorkspace] = useReducer(
    updateAgentWorkspace,
    initialAgentWorkspace,
  );
  const [agentPanelWidth, setAgentPanelWidth] = useState(defaultAgentPanelWidth);
  const [scoutPositionOpen, setScoutPositionOpen] = useState(false);
  const [result, setResult] = useState<GigsResult | null>(null);
  const [peopleResult, setPeopleResult] = useState<PeopleResult | null>(null);
  const [taskResult, setTaskResult] = useState<TasksResult | null>(null);
  const refreshDashboard = () => {
    void Promise.all([
      loadGigs().then(setResult),
      loadPeople().then(setPeopleResult),
      loadTasks().then(setTaskResult),
    ]);
  };
  const handleScoutPositionOpenChange = useCallback((open: boolean) => {
    setScoutPositionOpen(open);
    if (open) dispatchAgentWorkspace({ type: "close" });
  }, []);
  useEffect(refreshDashboard, []);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [view]);
  if (!result || !peopleResult || !taskResult) return <main className="loading-screen"><span /><p>Loading search operations…</p></main>;
  if (!result.ok) return <AppError error={result.error} />;
  if (!peopleResult.ok) return <AppError error={peopleResult.error} />;
  if (!taskResult.ok) return <AppError error={taskResult.error} />;
  const dashboard = view === "gigs"
    ? <GigBoard gigs={result.data} onNavigate={setView} />
    : view === "network"
      ? <main className="app-shell network-shell"><Masthead today={todayInPacific()} active="network" onChange={setView} /><NetworkingBoard people={peopleResult.data} /></main>
      : view === "tasks"
        ? <main className="app-shell task-shell"><Masthead today={todayInPacific()} active="tasks" onChange={setView} /><TaskBoard tasks={taskResult.data} /></main>
        : <main className="app-shell"><Masthead today={todayInPacific()} active="scout" onChange={setView} /><GigScoutPage onPositionOpenChange={handleScoutPositionOpenChange} /></main>;
  return (
    <>
      <div
        className={agentWorkspace.open ? "dashboard-with-agent" : ""}
        data-agent-layout={agentWorkspace.open ? agentWorkspace.layout : undefined}
        style={{ "--agent-panel-width": `${agentPanelWidth}px` } as React.CSSProperties}
      >{dashboard}</div>
      {!scoutPositionOpen && <AgentLauncher
        open={agentWorkspace.open}
        layout={agentWorkspace.layout}
        onClick={() => dispatchAgentWorkspace({ type: "toggle" })}
      />}
      <div id="gig-finder-agent">
        <AgentPanel
          open={agentWorkspace.open}
          layout={agentWorkspace.layout}
          panelWidth={agentPanelWidth}
          onPanelWidthChange={setAgentPanelWidth}
          onLayoutChange={layout => dispatchAgentWorkspace({ type: "set-layout", layout })}
          onClose={() => dispatchAgentWorkspace({ type: "close" })}
          onDataChanged={refreshDashboard}
        />
      </div>
    </>
  );
}

export function AppError({ error }: { error: unknown }) {
  return <main className="fatal-error"><span className="eyebrow">Data fault</span><h1>Dashboard data could not be loaded.</h1><p>{error instanceof Error ? error.message : "An unknown error occurred."}</p><code>Check the local API and SQLite database</code></main>;
}
