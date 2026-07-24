import { useEffect, useMemo, useRef, useState } from "react";
import { todayInPacific } from "./domain/board";
import { compareTasks, taskIsDueToday, taskIsOverdue, taskPriorities, taskStatusLabels, taskTypeLabels, taskTypes, type TaskPriority, type TaskRecord, type TaskStatus, type TaskType } from "../../core/src/tasks";

function TaskDrawer({ task, onClose }: { task: TaskRecord; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [onClose]);
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="Close task details" onClick={onClose} /><aside className="role-drawer task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-drawer-title">
    <header className="drawer-header task-drawer-header"><div><span className="eyebrow">Task brief</span><h2 id="task-drawer-title">{task.title}</h2><p>{task.relatedEntity.label}</p></div><button ref={closeRef} className="icon-button" aria-label="Close task details" onClick={onClose}>×</button></header>
    <div className="drawer-body"><div className="drawer-badges"><span className="task-priority" data-priority={task.priority}>{task.priority} priority</span><span className="stage-chip">{taskStatusLabels[task.status]}</span><span className="stage-chip">{taskTypeLabels[task.type]}</span></div>
      <dl className="detail-grid"><div className="detail-item"><dt>Due date</dt><dd>{task.dueDate ?? "No deadline"}</dd></div><div className="detail-item"><dt>Related to</dt><dd>{task.relatedEntity.type} · {task.relatedEntity.label}</dd></div><div className="detail-item"><dt>Created</dt><dd>{task.createdAt}</dd></div><div className="detail-item"><dt>Last updated</dt><dd>{task.updatedAt}</dd></div>{task.completedAt && <div className="detail-item"><dt>Completed</dt><dd>{task.completedAt}</dd></div>}</dl>
      <section><h3>Context and instructions</h3><p className="status-narrative">{task.notes ?? "No additional notes captured."}</p></section>
      <p className="read-only-note">Read-only view · update tasks through the job-search CLI</p>
    </div>
  </aside></div>;
}

export function TaskBoard({ tasks }: { tasks: TaskRecord[] }) {
  const today = todayInPacific();
  const [status, setStatus] = useState<TaskStatus | "active" | "all">("active");
  const [priority, setPriority] = useState<TaskPriority | "all">("all");
  const [type, setType] = useState<TaskType | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TaskRecord | null>(null);
  const active = tasks.filter((task) => ["open", "in_progress"].includes(task.status));
  const overdue = active.filter((task) => taskIsOverdue(task, today)).length;
  const dueToday = active.filter((task) => taskIsDueToday(task, today)).length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const visible = useMemo(() => tasks.filter((task) => {
    if (status === "active" && !["open", "in_progress"].includes(task.status)) return false;
    if (status !== "active" && status !== "all" && task.status !== status) return false;
    if (priority !== "all" && task.priority !== priority) return false;
    if (type !== "all" && task.type !== type) return false;
    const query = search.trim().toLowerCase();
    return !query || [task.title, task.relatedEntity.label, task.notes].some((value) => value?.toLowerCase().includes(query));
  }).sort((a, b) => compareTasks(a, b, today)), [tasks, status, priority, type, search, today]);

  return <>
    <section className="metrics task-metrics" aria-label="Task summary"><article className={overdue ? "alert-metric" : ""}><span>Overdue</span><strong>{String(overdue).padStart(2, "0")}</strong><small>RECOVERY QUEUE</small></article><article><span>Due today</span><strong>{String(dueToday).padStart(2, "0")}</strong><small>TODAY'S COMMITMENTS</small></article><article><span>Open tasks</span><strong>{String(active.length).padStart(2, "0")}</strong><small>ACTIVE WORK</small></article><article><span>Completed</span><strong>{String(completed).padStart(2, "0")}</strong><small>RECORDED WINS</small></article></section>
    <section className="controls task-controls" aria-label="Task controls"><label className="search-control"><span className="sr-only">Search tasks</span><span className="search-glyph">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, people, companies…" /></label><label className="select-control">Status<select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | "active" | "all")}><option value="active">Active</option><option value="all">All statuses</option>{Object.entries(taskStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="select-control">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | "all")}><option value="all">All priorities</option>{taskPriorities.map((value) => <option value={value} key={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label><label className="select-control">Type<select value={type} onChange={(event) => setType(event.target.value as TaskType | "all")}><option value="all">All types</option>{taskTypes.map((value) => <option value={value} key={value}>{taskTypeLabels[value]}</option>)}</select></label><button className="clear-button" onClick={() => { setSearch(""); setStatus("active"); setPriority("all"); setType("all"); }}>Clear</button></section>
    <div className="board-heading task-heading"><div><span className="eyebrow">Dispatch ledger / {today}</span><h2>{visible.length} tasks in view</h2></div><p>Ordered by overdue status, deadline, and priority.</p></div>
    <section className="task-ledger" aria-label="task list"><header><span>Signal</span><span>Task</span><span>Related</span><span>Type</span><span>Due</span><span>Status</span></header>{visible.map((task, index) => { const overdueTask = taskIsOverdue(task, today); const todayTask = taskIsDueToday(task, today); return <button type="button" className={`task-row ${overdueTask ? "is-overdue" : ""} ${todayTask ? "is-today" : ""}`} onClick={() => setSelected(task)} key={task.id} style={{ "--task-index": index } as React.CSSProperties}><span className="task-signal"><i data-priority={task.priority} />{overdueTask ? "OVERDUE" : todayTask ? "TODAY" : task.priority.toUpperCase()}</span><span className="task-title-cell"><strong>{task.title}</strong><small>{task.notes ?? "No supporting notes"}</small></span><span>{task.relatedEntity.label}</span><span>{taskTypeLabels[task.type]}</span><span className="task-due">{task.dueDate ?? "—"}</span><span>{taskStatusLabels[task.status]} <b>›</b></span></button>; })}{visible.length === 0 && <div className="task-empty">No tasks match these filters.</div>}</section>
    <footer className="app-footer"><span>READ-ONLY MODE</span><span>Source: SQLite</span><span>{tasks.length} total records</span></footer>
    {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} />}
  </>;
}
