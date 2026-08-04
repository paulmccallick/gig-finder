import { useMemo, useRef, useEffect, useState } from "react";
import { comparePeople, personIsOverdue, personPriorities, priorityLabels, statusLabels, type PersonPriority, type Person } from "../../core/people";
import { todayInPacific } from "./domain/board";

const lanes = [
  { key: "ready", label: "Ready to Reach", statuses: ["not_contacted", "outreach_planned"] },
  { key: "waiting", label: "In Motion", statuses: ["outreach_sent", "awaiting_response", "follow_up_due"] },
  { key: "scheduled", label: "On Calendar", statuses: ["conversation_scheduled"] },
  { key: "active", label: "Active Circle", statuses: ["active_relationship"] },
] as const;

function PersonCard({ person, onSelect, today }: { person: Person; onSelect: (person: Person) => void; today: string }) {
  const overdue = personIsOverdue(person, today);
  return <button className="record-card contact-card" onClick={() => onSelect(person)} type="button">
    <span className="card-signal" data-priority={person.priority} />
    <span className="contact-topline"><span className="priority-chip" data-priority={person.priority}>{priorityLabels[person.priority]}</span>{person.tags.includes("profile-enrichment-batch-1") && <span className="tranche-chip">TRANCHE 01</span>}</span>
    <span className="card-company">{person.company ?? "Company not captured"}</span>
    <span className="card-title contact-name">{person.name}</span>
    <span className="contact-role">{person.title ?? "Title not captured"}</span>
    <span className={`action-line ${overdue ? "is-overdue" : ""}`}><span className="action-glyph">→</span><span>{person.outreach.nextAction ?? statusLabels[person.status]}</span></span>
    <span className="card-footer"><span>{overdue ? "OVERDUE" : person.outreach.nextActionDue ?? "NO DEADLINE"}</span><span>{person.profileStatus === "verified" ? "PROFILE ✓" : "PROFILE —"}</span><span>›</span></span>
  </button>;
}

function PersonDrawer({ person, onClose }: { person: Person; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [onClose]);
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="Close person details" onClick={onClose} /><aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="person-drawer-title">
    <header className="drawer-header contact-drawer-header"><div><span className="eyebrow">Relationship dossier</span><h2 id="person-drawer-title">{person.name}</h2><p>{person.title ?? "Title not captured"}{person.company ? ` · ${person.company}` : ""}</p></div><button ref={closeRef} className="icon-button" aria-label="Close person details" onClick={onClose}>×</button></header>
    <div className="drawer-body">
      <div className="drawer-badges"><span className="priority-chip" data-priority={person.priority}>{priorityLabels[person.priority]} priority</span><span className="stage-chip">{statusLabels[person.status]}</span><span className="stage-chip">{person.relationship.strength} relationship</span></div>
      <div className="drawer-actions">{person.linkedInProfileUrl ? <a className="apply-link" href={person.linkedInProfileUrl} target="_blank" rel="noreferrer">Open LinkedIn profile <span>↗</span></a> : <span className="application-unavailable">LinkedIn profile not yet captured</span>}</div>
      {person.whyInteresting && <section><h3>Why this relationship matters</h3><p className="status-narrative">{person.whyInteresting}</p></section>}
      <dl className="detail-grid">
        <div className="detail-item"><dt>Relationship</dt><dd>{person.relationship.type.replaceAll("_", " ")} · {person.relationship.strength}</dd></div>
        <div className="detail-item"><dt>Introduced by</dt><dd>{person.relationship.introducedBy ?? "Direct relationship"}</dd></div>
        <div className="detail-item"><dt>Last contact</dt><dd>{person.outreach.lastContacted ?? "Not recorded"}</dd></div>
        <div className="detail-item"><dt>Method</dt><dd>{person.outreach.lastContactMethod?.replaceAll("_", " ") ?? "—"}</dd></div>
        <div className="detail-item"><dt>Next action</dt><dd>{person.outreach.nextAction ?? "No next action"}</dd></div>
        <div className="detail-item"><dt>Due</dt><dd>{person.outreach.nextActionDue ?? "No deadline"}</dd></div>
      </dl>
      {person.outreach.lastContactSummary && <section><h3>Latest touchpoint</h3><p className="secondary-copy">{person.outreach.lastContactSummary}</p></section>}
      {(person.relationship.notes || person.notes.length > 0) && <section><h3>Relationship notes</h3>{person.relationship.notes && <p className="secondary-copy">{person.relationship.notes}</p>}{person.notes.map((note) => <p className="secondary-copy" key={note}>{note}</p>)}</section>}
      {person.tags.length > 0 && <div className="tag-list">{person.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
    </div>
  </aside></div>;
}

export function NetworkingBoard({ people }: { people: Person[] }) {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<PersonPriority | "all">("high");
  const [trancheOnly, setTrancheOnly] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);
  useEffect(() => {
    if (!selected) return;
    setSelected(people.find(person => person.id === selected.id) ?? null);
  }, [people, selected?.id]);
  const today = todayInPacific();
  const actionable = people.filter((person) => !["paused", "do_not_contact"].includes(person.status));
  const visible = useMemo(() => actionable.filter((c) => {
    if (priority !== "all" && c.priority !== priority) return false;
    if (trancheOnly && !c.tags.includes("profile-enrichment-batch-1")) return false;
    const q = search.trim().toLowerCase();
    return !q || [c.name, c.company, c.title, c.whyInteresting].some((value) => value?.toLowerCase().includes(q));
  }), [actionable, priority, trancheOnly, search]);
  const overdue = actionable.filter((c) => personIsOverdue(c, today)).length;
  const scheduled = actionable.filter((c) => c.status === "conversation_scheduled").length;
  const high = actionable.filter((c) => c.priority === "high").length;
  const verified = actionable.filter((c) => c.profileStatus === "verified").length;

  return <>
    <section className="metrics network-metrics" aria-label="Networking summary">
      <article><span>High priority</span><strong>{String(high).padStart(2, "0")}</strong><small>FOCUS CIRCLE</small></article>
      <article><span>Profiles verified</span><strong>{String(verified).padStart(2, "0")}</strong><small>IDENTITY READY</small></article>
      <article className={overdue ? "alert-metric" : ""}><span>Follow-ups overdue</span><strong>{String(overdue).padStart(2, "0")}</strong><small>NEEDS ATTENTION</small></article>
      <article><span>Meetings scheduled</span><strong>{String(scheduled).padStart(2, "0")}</strong><small>ON CALENDAR</small></article>
    </section>
    <section className="controls" aria-label="Networking controls">
      <label className="search-control"><span className="sr-only">Search people</span><span className="search-glyph">⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search person, company, title…" /></label>
      <label className="select-control">Priority<select value={priority} onChange={(e) => setPriority(e.target.value as PersonPriority | "all")}><option value="all">All priorities</option>{personPriorities.map((p) => <option key={p} value={p}>{priorityLabels[p]}</option>)}</select></label>
      <label className="check-control"><input type="checkbox" checked={trancheOnly} onChange={(e) => setTrancheOnly(e.target.checked)} /><span /> First tranche only</label>
      <button className="clear-button" onClick={() => { setSearch(""); setPriority("all"); setTrancheOnly(false); }}>Clear</button>
    </section>
    <section className="kanban-board networking-board" aria-label="networking board">{lanes.map((lane, index) => { const lanePeople = visible.filter((person) => (lane.statuses as readonly string[]).includes(person.status)).sort((a, b) => comparePeople(a, b, today)); return <section className="kanban-column" key={lane.key} style={{ "--column-index": index } as React.CSSProperties}><header><span className="column-number">{String(index + 1).padStart(2, "0")}</span><h3>{lane.label}</h3><span className="column-count">{lanePeople.length}</span></header><div className="card-stack">{lanePeople.map((person) => <PersonCard person={person} onSelect={setSelected} today={today} key={person.id} />)}{lanePeople.length === 0 && <div className="column-empty"><span>NO SIGNALS</span><p>No people match this lane</p></div>}</div></section>; })}</section>
    <footer className="app-footer"><span>READ-ONLY MODE</span><span>Source: SQLite</span><span>{people.length} total records</span></footer>
    {selected && <PersonDrawer person={selected} onClose={() => setSelected(null)} />}
  </>;
}
