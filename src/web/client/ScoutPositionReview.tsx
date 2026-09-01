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
  externalId: string | null;
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

type PostingResolution =
  | { kind: "create_new"; reviewedFingerprint: string }
  | {
      kind: "use_existing";
      reviewedFingerprint: string;
      gigId: string;
      expectedGigRevision: number;
    };

type GigPostingCandidate = {
  gigId: string;
  revision: number;
  company: string;
  title: string;
  externalJobId: string | null;
  sourceUrl: string | null;
  location: string | null;
  stage: string;
  outcome: string;
  availability: string;
  lastActivity: string;
  jobDescription: {
    id: string;
    type: string;
    title: string | null;
    displayName: string;
    version?: number;
  } | null;
};

type ResolutionReview = {
  fingerprint: string;
  candidates: GigPostingCandidate[];
};

type DecisionOutcome =
  | PromotionDetail
  | ({ status: "resolution_required" | "resolution_stale" } & ResolutionReview)
  | { status: "resolution_invalid" }
  | { status: "created" | "updated"; position: PromotionDetail | null }
  | { error?: string };

export interface ScoutPositionReviewProps {
  onPositionOpenChange(open: boolean): void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatComparisonDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function CandidateDescriptionLink({ candidate }: { candidate: GigPostingCandidate }) {
  const document = candidate.jobDescription;
  if (!document?.version) return <span className="scout-resolution-unavailable">No stored description</span>;
  return <a
    href={`/documents/${encodeURIComponent(document.id)}/versions/${document.version}`}
    target="_blank"
    rel="opener"
  >Open stored description</a>;
}

async function readResponseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function nearestPageOffset(
  total: number,
  offset: number,
  limit: number,
): number {
  if (![total, offset, limit].every(Number.isInteger)
    || total < 0 || offset < 0 || limit <= 0) {
    throw new Error("Invalid Scout position pagination.");
  }
  if (total === 0) return 0;
  return Math.min(offset, Math.floor((total - 1) / limit) * limit);
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

export function PositionReviewDrawer({
  detail,
  error,
  note,
  reviewAt,
  resolutionReview,
  resolutionChoice,
  onClose,
  onNoteChange,
  onReviewAtChange,
  onDecide,
  onResolve,
  onRetryPromotion,
  submittingAction,
}: {
  detail: PromotionDetail;
  error: string | null;
  note: string;
  reviewAt: string;
  resolutionReview: ResolutionReview | null;
  resolutionChoice: PostingResolution | null;
  onClose(): void;
  onNoteChange(value: string): void;
  onReviewAtChange(value: string): void;
  onDecide(action: "irrelevant" | "defer" | "pursue"): void;
  onResolve(resolution: PostingResolution): void;
  onRetryPromotion(): void;
  submittingAction: "pursue" | "irrelevant" | "defer" | "retry" | "resolve" | null;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const canClose = submittingAction === null;
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const descriptionPath = `/gig-scout/positions/${encodeURIComponent(detail.id)}/description`;
  const descriptionHref = parseScoutDescriptionViewerPath(descriptionPath)
    ? descriptionPath
    : "/?workspace=scout";

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canCloseRef.current) onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter(element => element.getClientRects().length > 0);
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return <div className="drawer-layer">
    <button className="drawer-scrim" aria-label="Close position review" disabled={!canClose} onClick={onClose} />
    <aside
      ref={drawerRef}
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
        <button ref={closeRef} className="icon-button" aria-label="Close position review" disabled={!canClose} onClick={onClose}>×</button>
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
            <textarea value={note} maxLength={2000} disabled={submittingAction !== null} onChange={event => onNoteChange(event.target.value)} />
          </label>
          {resolutionReview ? <div className="scout-resolution-comparison">
            <p className="scout-resolution-intro">GigFinder found existing records that may describe this posting. Review the stored evidence and choose explicitly.</p>
            <article className="scout-resolution-record is-reviewed">
              <header><span>Reviewed Scout posting</span><strong>{detail.company}</strong><h4>{detail.title}</h4></header>
              <dl className="scout-resolution-fields">
                <div><dt>Requisition ID</dt><dd>{detail.externalId ?? "Not listed"}</dd></div>
                <div><dt>Location</dt><dd>{detail.location ?? "Not listed"}</dd></div>
                <div className="is-wide"><dt>Official URL</dt><dd><a href={detail.canonicalUrl} target="_blank" rel="noreferrer">{detail.canonicalUrl}</a></dd></div>
              </dl>
              <a href={descriptionHref} target="_blank" rel="opener">Open Scout description</a>
            </article>
            <div className="scout-resolution-candidates">
              {resolutionReview.candidates.map(candidate => {
                const resolution: PostingResolution = {
                  kind: "use_existing",
                  reviewedFingerprint: resolutionReview.fingerprint,
                  gigId: candidate.gigId,
                  expectedGigRevision: candidate.revision,
                };
                const selected = resolutionChoice?.kind === "use_existing"
                  && resolutionChoice.gigId === candidate.gigId;
                return <article className={`scout-resolution-record${selected ? " is-selected" : ""}`} key={candidate.gigId}>
                  <header><span>Existing Gig</span><strong>{candidate.company}</strong><h4>{candidate.title}</h4></header>
                  <dl className="scout-resolution-fields">
                    <div><dt>Requisition ID</dt><dd>{candidate.externalJobId ?? "Not listed"}</dd></div>
                    <div><dt>Location</dt><dd>{candidate.location ?? "Not listed"}</dd></div>
                    <div><dt>Stage / outcome</dt><dd>{titleCase(candidate.stage)} / {titleCase(candidate.outcome)}</dd></div>
                    <div><dt>Availability</dt><dd>{titleCase(candidate.availability)}</dd></div>
                    <div><dt>Last activity</dt><dd>{formatComparisonDate(candidate.lastActivity)}</dd></div>
                    <div className="is-wide"><dt>Official URL</dt><dd>{candidate.sourceUrl ? <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">{candidate.sourceUrl}</a> : "Not stored"}</dd></div>
                  </dl>
                  <div className="scout-resolution-record-actions">
                    <CandidateDescriptionLink candidate={candidate} />
                    <button type="button" disabled={submittingAction !== null} onClick={() => onResolve(resolution)}>Use this Gig</button>
                  </div>
                </article>;
              })}
            </div>
            <button
              type="button"
              className={`scout-resolution-create${resolutionChoice?.kind === "create_new" ? " is-selected" : ""}`}
              disabled={submittingAction !== null}
              onClick={() => onResolve({ kind: "create_new", reviewedFingerprint: resolutionReview.fingerprint })}
            >Create separate Gig</button>
          </div> : <>
            <div className="scout-review-decision-actions">
              <button type="button" disabled={submittingAction !== null} onClick={() => onDecide("pursue")}>Pursue position</button>
              <button type="button" disabled={submittingAction !== null} onClick={() => onDecide("irrelevant")}>Mark irrelevant</button>
            </div>
            <label className="scout-review-defer">
              Review again at
              <input type="datetime-local" value={reviewAt} disabled={submittingAction !== null} onChange={event => onReviewAtChange(event.target.value)} />
            </label>
            <button type="button" className="clear-button" onClick={() => onDecide("defer")} disabled={!reviewAt || submittingAction !== null}>Defer review</button>
          </>}
          {detail.promotionStatus === "failed" && <div className="scout-review-promotion-error">
            <p role="alert">{detail.promotionFailureMessage ?? "Promotion failed."}</p>
            <button type="button" disabled={submittingAction !== null} onClick={onRetryPromotion}>Retry promotion</button>
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
            rel="opener"
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
  onPositionOpenChange,
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
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromotionDetail | null>(null);
  const [note, setNote] = useState("");
  const [reviewAt, setReviewAt] = useState("");
  const [resolutionReview, setResolutionReview] = useState<ResolutionReview | null>(null);
  const [resolutionChoice, setResolutionChoice] = useState<PostingResolution | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"pursue" | "irrelevant" | "defer" | "retry" | "resolve" | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshRequestRef = useRef(false);
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const selectedRef = useRef<string | null>(null);
  const limit = 20;
  const states = ["actionable", "processing", "needs_user_review", "deferred"];

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let succeeded = false;
    const backgroundRefresh = refreshRequestRef.current;
    refreshRequestRef.current = false;
    const query = new URLSearchParams({
      state,
      offset: String(offset),
      limit: String(limit),
      sort,
      direction: "desc",
    });
    if (company) query.set("company", company);
    if (text) query.set("text", text);
    if (backgroundRefresh) {
      setRefreshing(true);
      setRefreshError(null);
    } else {
      setLoading(true);
    }
    void fetch(`/api/gig-scout/positions?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Could not load Scout positions.");
      return response.json() as Promise<{ items: WorkspacePosition[]; total: number; counts: Record<string, number> }>;
    }).then(page => {
      if (!active) return;
      const repairedOffset = nearestPageOffset(page.total, offset, limit);
      if (repairedOffset !== offset) {
        setOffset(repairedOffset);
        return;
      }
      setItems(page.items);
      setTotal(page.total);
      setCounts(page.counts);
      setListError(null);
      setRefreshError(null);
      succeeded = true;
    }).catch(reason => {
      if (!active || (reason instanceof Error && reason.name === "AbortError")) return;
      const message = reason instanceof Error ? reason.message : "Could not load Scout positions.";
      if (backgroundRefresh) setRefreshError(message);
      else setListError(message);
    }).finally(() => {
      if (!active) return;
      setLoading(false);
      setRefreshing(false);
      const scroll = pendingScrollRef.current;
      if (scroll) {
        window.requestAnimationFrame(() => window.scrollTo(scroll.x, scroll.y));
        if (succeeded) pendingScrollRef.current = null;
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [state, sort, company, text, offset, refreshVersion]);

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
      .then(value => {
        if (!active) return;
        setDetail(value);
        setListError(null);
      })
      .catch(() => {
        if (!active) return;
        selectedRef.current = null;
        setSelected(null);
        setDetail(null);
        setListError("Could not open that position. Select it to try again.");
        onPositionOpenChange(false);
      });
    return () => { active = false; };
  }, [onPositionOpenChange, selected]);

  const closeDrawer = useCallback(() => {
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
    setNote("");
    setReviewAt("");
    setResolutionReview(null);
    setResolutionChoice(null);
    setDrawerError(null);
    setSubmittingAction(null);
    onPositionOpenChange(false);
  }, [onPositionOpenChange]);
  const openPosition = (id: string) => {
    if (selectedRef.current !== id) {
      setNote("");
      setReviewAt("");
      setResolutionReview(null);
      setResolutionChoice(null);
    }
    selectedRef.current = id;
    onPositionOpenChange(true);
    setDrawerError(null);
    setSelected(id);
  };

  useEffect(() => () => onPositionOpenChange(false), [onPositionOpenChange]);

  const refreshPositions = () => {
    refreshRequestRef.current = true;
    setRefreshVersion(value => value + 1);
  };

  const completeDecision = (id: string) => {
    pendingScrollRef.current = { x: window.scrollX, y: window.scrollY };
    setItems(values => values.filter(value => value.id !== id));
    setTotal(value => Math.max(0, value - 1));
    closeDrawer();
    refreshPositions();
    const scroll = pendingScrollRef.current;
    if (scroll) window.requestAnimationFrame(() => window.scrollTo(scroll.x, scroll.y));
  };
  const retryPromotion = async () => {
    if (!detail || submittingAction !== null) return;
    const positionId = detail.id;
    setSubmittingAction("retry");
    try {
      const response = await fetch(`/api/gig-scout/positions/${encodeURIComponent(positionId)}/promotion/retry`, { method: "POST" });
      const outcome = await readResponseJson<PromotionDetail | { error?: string }>(response);
      if (selectedRef.current !== positionId) return;
      if (!response.ok) {
        setDrawerError(outcome && "error" in outcome ? outcome.error ?? "Promotion retry failed." : "Promotion retry failed.");
        return;
      }
      if (outcome && "promotionStatus" in outcome && outcome.promotionStatus === "failed") {
        setDetail(outcome);
        setDrawerError(outcome.promotionFailureMessage ?? "Promotion retry failed.");
        return;
      }
      completeDecision(positionId);
    } catch {
      if (selectedRef.current === positionId) setDrawerError("Promotion retry could not reach the server.");
    } finally {
      setSubmittingAction(null);
    }
  };
  const decide = async (action: "irrelevant" | "defer" | "pursue", resolution?: PostingResolution) => {
    if (submittingAction !== null || !detail?.descriptionId || !detail.relevanceEvaluationId || !detail.candidateMatchEvaluationId) return;
    const positionId = detail.id;
    setSubmittingAction(resolution ? "resolve" : action);
    if (resolution) setResolutionChoice(resolution);
    try {
      const response = await fetch(`/api/gig-scout/positions/${encodeURIComponent(positionId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          changeId: `change_${crypto.randomUUID()}`,
          action,
          note: note.trim() || undefined,
          reviewAt: action === "defer" ? new Date(reviewAt).toISOString() : undefined,
          expectedStateRevision: detail.stateRevision,
          descriptionId: detail.descriptionId,
          relevanceEvaluationId: detail.relevanceEvaluationId,
          candidateMatchEvaluationId: detail.candidateMatchEvaluationId,
          resolution,
        }),
      });
      const outcome = await readResponseJson<DecisionOutcome>(response);
      if (selectedRef.current !== positionId) return;
      if (!response.ok) {
        if (response.status === 409) {
          const refreshed = await fetch(`/api/gig-scout/positions/${encodeURIComponent(positionId)}`, { cache: "no-store" });
          const refreshedDetail = await readResponseJson<PromotionDetail>(refreshed);
          if (refreshed.ok && refreshedDetail && selectedRef.current === positionId) {
            setDetail(refreshedDetail);
            setResolutionReview(null);
            setResolutionChoice(null);
          }
          setDrawerError("This position was revised. Review the latest details before deciding.");
          return;
        }
        setDrawerError(outcome && "error" in outcome ? outcome.error ?? "Could not save position decision." : "Could not save position decision.");
        return;
      }
      if (outcome && "promotionStatus" in outcome && outcome.promotionStatus === "failed") {
        setDetail(outcome);
        setDrawerError(outcome.promotionFailureMessage ?? "Promotion failed. Retry is available.");
        return;
      }
      if (outcome && "status" in outcome) {
        if (outcome.status === "resolution_required" || outcome.status === "resolution_stale") {
          setResolutionReview({
            fingerprint: outcome.fingerprint,
            candidates: outcome.candidates,
          });
          setResolutionChoice(null);
          setDrawerError(outcome.status === "resolution_stale"
            ? "The Gig evidence changed. Review the refreshed comparison before choosing again."
            : null);
          return;
        }
        if (outcome.status === "resolution_invalid") {
          setDrawerError("That Gig is no longer available for this posting. Review the comparison and choose again.");
          return;
        }
      }
      completeDecision(positionId);
    } catch {
      if (selectedRef.current === positionId) setDrawerError("The decision could not reach the server.");
    } finally {
      setSubmittingAction(null);
    }
  };

  return <section aria-labelledby="positions-title">
    <h3 id="positions-title">Positions</h3>
    <p>One cross-run workspace for official positions that still need attention.</p>
    <RelevanceSettings />
    {listError && <p role="alert">{listError}</p>}
    {refreshError && <p role="alert" className="scout-review-refresh-error">{refreshError} <button type="button" onClick={refreshPositions}>Retry refresh</button></p>}
    {refreshing && <p role="status" className="scout-review-refreshing">Refreshing positions…</p>}
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
    {loading && items.length === 0 ? <p role="status">Loading positions…</p> : items.length === 0 ? <p>No positions match the active filters.</p> : <section className="scout-review-ledger" aria-label="Positions for review">
      <header><span>Score</span><span>Position</span><span>Company</span><span>First seen</span></header>
      {items.map((position, index) => <button
        key={position.id}
        type="button"
        className="scout-review-row"
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
      error={drawerError}
      note={note}
      reviewAt={reviewAt}
      resolutionReview={resolutionReview}
      resolutionChoice={resolutionChoice}
      onClose={closeDrawer}
      onNoteChange={setNote}
      onReviewAtChange={setReviewAt}
      onDecide={action => void decide(action)}
      onResolve={resolution => void decide("pursue", resolution)}
      onRetryPromotion={() => void retryPromotion()}
      submittingAction={submittingAction}
    />}
  </section>;
}
