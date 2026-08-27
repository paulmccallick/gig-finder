import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { parseScoutDescriptionViewerPath } from "./DocumentViewShell";

type WorkspacePosition = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  canonicalUrl: string;
  state: string;
  stateRevision: number;
  processingStage: string | null;
  processingStatus: string | null;
  processingFailureMessage: string | null;
  descriptionAvailable: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
  score: number | null;
  scoreExplanation: string | null;
  criteriaVersion: number | null;
  rubricVersion: number | null;
  profileVersion: string | null;
  model: string | null;
  provider: string | null;
};

type WorkspaceDetail = WorkspacePosition & {
  descriptionId: string | null;
  descriptionMarkdown: string | null;
  descriptionSourceUrl: string | null;
  descriptionRetrievedAt: string | null;
  descriptionProvenance: unknown;
  relevanceEvaluationId: string | null;
  relevanceReason: string | null;
  candidateMatchEvaluationId: string | null;
  observations: Array<{
    id: string;
    runId: string;
    sourceKey: string;
    sourceStatus: string;
    title: string;
    canonicalUrl: string;
    location: string | null;
    observedAt: string;
    descriptionAvailable: boolean;
  }>;
};

type PromotionDetail = WorkspaceDetail & {
  promotionStatus?: string;
  promotionFailureMessage?: string;
};

const noOp = () => {};

export interface ScoutPositionReviewProps {
  onOpenPosition?: () => void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function RelevanceSettings(): JSX.Element {
  const [criteria, setCriteria] = useState("");
  const [threshold, setThreshold] = useState(0.85);
  const [version, setVersion] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/gig-scout/settings/relevance", { cache: "no-store" })
      .then(response => response.json())
      .then(value => {
        setCriteria(value.criteria);
        setThreshold(value.confidenceThreshold);
        setVersion(value.version);
      });
  }, []);
  const save = async () => {
    const response = await fetch("/api/gig-scout/settings/relevance", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ criteria, confidenceThreshold: threshold }),
    });
    if (!response.ok) {
      setMessage("Could not save relevance criteria.");
      return;
    }
    const value = await response.json();
    setVersion(value.version);
    setMessage("Relevance criteria saved.");
  };
  return <details>
    <summary>Relevance criteria {version ? `(v${version})` : ""}</summary>
    <label>Technology-role relevance criteria <textarea value={criteria} onChange={event => setCriteria(event.target.value)} /></label>
    <label>Definitive-failure confidence threshold <input type="number" min="0" max="1" step="0.01" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /></label>
    <button type="button" onClick={() => void save()}>Save criteria version</button>
    {message && <p role="status">{message}</p>}
  </details>;
}

function PositionReviewDrawer({
  detail,
  error,
  note,
  reviewAt,
  onClose,
  onNoteChange,
  onReviewAtChange,
  onDecide,
  onRetryPromotion,
}: {
  detail: PromotionDetail;
  error: string | null;
  note: string;
  reviewAt: string;
  onClose(): void;
  onNoteChange(value: string): void;
  onReviewAtChange(value: string): void;
  onDecide(action: "irrelevant" | "defer" | "pursue"): void;
  onRetryPromotion(): void;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const descriptionPath = `/gig-scout/positions/${encodeURIComponent(detail.id)}/description`;
  const descriptionHref = parseScoutDescriptionViewerPath(descriptionPath)
    ? descriptionPath
    : "/?workspace=scout";

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

  return <div className="drawer-layer">
    <button className="drawer-scrim" aria-label="Close position review" onClick={onClose} />
    <aside
      className="record-drawer scout-review-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scout-review-drawer-title"
    >
      <header className="drawer-header scout-review-drawer-header">
        <div>
          <span className="eyebrow">Position review</span>
          <h2 id="scout-review-drawer-title">{detail.title}</h2>
          <p>{detail.company} · {detail.location ?? "Location not listed"}</p>
        </div>
        <button ref={closeRef} className="icon-button" aria-label="Close position review" onClick={onClose}>×</button>
      </header>
      <div className="drawer-body">
        <div className="drawer-badges">
          <span className="scout-review-score-chip">
            {detail.score === null ? "— match" : `${detail.score} / 10 match`}
          </span>
        </div>
        <section>
          <h3>Candidate-match assessment</h3>
          <p className="status-narrative">
            {detail.scoreExplanation ?? "No candidate-match explanation is available."}
          </p>
        </section>
        <section className="scout-review-decision">
          <h3>Your decision</h3>
          <label className="scout-review-note">
            Private note (optional)
            <textarea value={note} maxLength={2000} onChange={event => onNoteChange(event.target.value)} />
          </label>
          <div className="scout-review-decision-actions">
            <button type="button" onClick={() => onDecide("pursue")}>Pursue position</button>
            <button type="button" onClick={() => onDecide("irrelevant")}>Mark irrelevant</button>
          </div>
          <label className="scout-review-defer">
            Review again at
            <input type="datetime-local" value={reviewAt} onChange={event => onReviewAtChange(event.target.value)} />
          </label>
          <button type="button" className="clear-button" onClick={() => onDecide("defer")} disabled={!reviewAt}>Defer review</button>
          {detail.promotionStatus === "failed" && <div className="scout-review-promotion-error">
            <p role="alert">{detail.promotionFailureMessage ?? "Promotion failed."}</p>
            <button type="button" onClick={onRetryPromotion}>Retry promotion</button>
          </div>}
          {error && <p role="alert">{error}</p>}
        </section>
        <section>
          <div className="section-heading">
            <h3>Official description</h3>
            <button type="button" onClick={() => setDescriptionExpanded(value => !value)}>
              {descriptionExpanded ? "Collapse description" : "Expand description"}
            </button>
          </div>
          <p className="secondary-copy">
            Retrieved {detail.descriptionRetrievedAt ? new Date(detail.descriptionRetrievedAt).toLocaleString() : "—"} from {" "}
            <a href={detail.descriptionSourceUrl ?? detail.canonicalUrl} target="_blank" rel="noreferrer">the official source</a>.
          </p>
          <pre className={`scout-review-description${descriptionExpanded ? " is-expanded" : ""}`}>
            {detail.descriptionMarkdown ?? "Description unavailable."}
          </pre>
          <a
            className="scout-review-document-link"
            href={descriptionHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${detail.title} description in document view`}
          >
            Open in document view
          </a>
        </section>
        <details className="scout-review-diagnostics">
          <summary>Scout diagnostics</summary>
          <dl className="detail-grid">
            <div className="detail-item"><dt>First seen</dt><dd>{formatDate(detail.firstSeenAt)}</dd></div>
            <div className="detail-item"><dt>Last seen</dt><dd>{formatDate(detail.lastSeenAt)}</dd></div>
            <div className="detail-item"><dt>Processing</dt><dd>{detail.processingStage?.replaceAll("_", " ") ?? "No active stage"} · {detail.processingStatus ?? "—"}</dd></div>
            <div className="detail-item"><dt>Observations</dt><dd>{detail.observationCount}</dd></div>
          </dl>
          {detail.processingFailureMessage && <p role="alert">{detail.processingFailureMessage}</p>}
          <ul>
            {detail.observations.map(observation => <li key={observation.id}>
              <a href={observation.canonicalUrl} target="_blank" rel="noreferrer">{observation.title}</a> · {observation.sourceKey} · {observation.sourceStatus} · {new Date(observation.observedAt).toLocaleString()}
            </li>)}
          </ul>
        </details>
      </div>
    </aside>
  </div>;
}

export function ScoutPositionReview({
  onOpenPosition = noOp,
}: ScoutPositionReviewProps): JSX.Element {
  const [items, setItems] = useState<WorkspacePosition[]>([]);
  const [state, setState] = useState("needs_user_review");
  const [sort, setSort] = useState("last_seen");
  const [company, setCompany] = useState("");
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromotionDetail | null>(null);
  const [note, setNote] = useState("");
  const [reviewAt, setReviewAt] = useState("");
  const limit = 20;
  const states = ["actionable", "processing", "needs_user_review", "deferred"];

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      state,
      offset: String(offset),
      limit: String(limit),
      sort,
      direction: "desc",
    });
    if (company) query.set("company", company);
    if (text) query.set("text", text);
    setLoading(true);
    void fetch(`/api/gig-scout/positions?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Could not load Scout positions.");
      return response.json() as Promise<{ items: WorkspacePosition[]; total: number; counts: Record<string, number> }>;
    }).then(page => {
      setItems(page.items);
      setTotal(page.total);
      setCounts(page.counts);
      setError(null);
    }).catch(reason => {
      if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [state, sort, company, text, offset]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    void fetch(`/api/gig-scout/positions/${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Could not load position history.");
        return response.json() as Promise<PromotionDetail>;
      })
      .then(value => { if (active) setDetail(value); })
      .catch(() => { if (active) setError("Could not load position history."); });
    return () => { active = false; };
  }, [selected]);

  const closeDrawer = useCallback(() => {
    setSelected(null);
    setDetail(null);
  }, []);
  const openPosition = (id: string) => {
    onOpenPosition();
    setError(null);
    setSelected(id);
  };
  const retryPromotion = async () => {
    if (!detail) return;
    const response = await fetch(`/api/gig-scout/positions/${encodeURIComponent(detail.id)}/promotion/retry`, { method: "POST" });
    const outcome = await response.json() as PromotionDetail | null;
    if (outcome?.promotionStatus === "failed") {
      setDetail(outcome);
      setError(outcome.promotionFailureMessage ?? "Promotion retry failed.");
      return;
    }
    setItems(values => values.filter(value => value.id !== detail.id));
    closeDrawer();
  };
  const decide = async (action: "irrelevant" | "defer" | "pursue") => {
    if (!detail?.descriptionId || !detail.relevanceEvaluationId || !detail.candidateMatchEvaluationId) return;
    const response = await fetch(`/api/gig-scout/positions/${encodeURIComponent(detail.id)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changeId: `change_${crypto.randomUUID()}`,
        action,
        note: note || undefined,
        reviewAt: action === "defer" ? new Date(reviewAt).toISOString() : undefined,
        expectedStateRevision: detail.stateRevision,
        descriptionId: detail.descriptionId,
        relevanceEvaluationId: detail.relevanceEvaluationId,
        candidateMatchEvaluationId: detail.candidateMatchEvaluationId,
      }),
    });
    if (!response.ok) {
      const value = await response.json() as { error?: string };
      setError(value.error ?? "Could not save position decision.");
      return;
    }
    const outcome = await response.json() as PromotionDetail | null;
    if (outcome?.promotionStatus === "failed") {
      setDetail(outcome);
      setError(outcome.promotionFailureMessage ?? "Promotion failed. Retry is available.");
      return;
    }
    setItems(values => values.filter(value => value.id !== detail.id));
    setTotal(value => Math.max(0, value - 1));
    closeDrawer();
    setNote("");
  };

  return <section aria-labelledby="positions-title">
    <h3 id="positions-title">Positions</h3>
    <p>One cross-run workspace for official positions that still need attention.</p>
    <RelevanceSettings />
    {error && <p role="alert">{error}</p>}
    <section className="controls scout-review-controls" aria-label="Position review controls">
      <label className="search-control">
        <span className="sr-only">Search positions</span>
        <span className="search-glyph">⌕</span>
        <input value={text} onChange={event => { setText(event.target.value); setOffset(0); }} placeholder="Search title or location…" />
      </label>
      <label className="select-control">View<select value={state} onChange={event => { setState(event.target.value); setOffset(0); }}>
        {states.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")} ({counts[value] ?? 0})</option>)}
      </select></label>
      <label className="select-control">Sort<select value={sort} onChange={event => { setSort(event.target.value); setOffset(0); }}>
        <option value="last_seen">Last seen</option><option value="score">Candidate-match score</option><option value="company">Company</option><option value="title">Title</option>
      </select></label>
      <label className="search-control scout-review-company-control">
        <span className="sr-only">Filter by company</span>
        <input value={company} onChange={event => { setCompany(event.target.value); setOffset(0); }} placeholder="Company" />
      </label>
      <button className="clear-button" onClick={() => { setState("needs_user_review"); setSort("last_seen"); setCompany(""); setText(""); setOffset(0); }}>Clear</button>
    </section>
    {loading ? <p role="status">Loading positions…</p> : items.length === 0 ? <p>No positions match the active filters.</p> : <section className="scout-review-ledger" aria-label="Positions for review">
      <header><span>Score</span><span>Position</span><span>Company</span><span>First seen</span></header>
      {items.map((position, index) => <button
        key={position.id}
        type="button"
        className="scout-review-row"
        aria-label={`Review ${position.title}`}
        onClick={() => openPosition(position.id)}
        style={{ "--scout-review-index": index } as CSSProperties}
      >
        <span className="scout-review-score">{position.score === null ? "—" : `${position.score}/10`}</span>
        <span className="scout-review-title-cell"><strong>{position.title}</strong><small className="scout-review-explanation">{position.scoreExplanation ?? "No candidate-match explanation available."}</small></span>
        <span className="scout-review-company"><strong>{position.company}</strong><small>{position.location ?? "Location not listed"}</small></span>
        <span className="scout-review-first-seen">{formatDate(position.firstSeenAt)}<b>›</b></span>
      </button>)}
    </section>}
    <nav className="scout-review-pagination" aria-label="Position pages">
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
      <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <button type="button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</button>
    </nav>
    {detail && <PositionReviewDrawer
      detail={detail}
      error={error}
      note={note}
      reviewAt={reviewAt}
      onClose={closeDrawer}
      onNoteChange={setNote}
      onReviewAtChange={setReviewAt}
      onDecide={action => void decide(action)}
      onRetryPromotion={() => void retryPromotion()}
    />}
  </section>;
}
