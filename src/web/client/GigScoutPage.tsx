import { useEffect, useState } from "react";
import { defaultScoutSearchProfile } from "../../core/scout/engine";
type Run = {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  companyCount: number;
  succeededCount: number;
  failedCount: number;
  searchProfile: { terms: string[]; locations: string[] };
};
type Position = {
  id: string;
  title: string;
  company: string;
  canonicalUrl: string;
  location: string | null;
  observedAt: string;
  sourceStatus: string;
  descriptionArtifactId: string | null;
  provenance: { sourceKey?: string; sourceUrl?: string; description?: string };
};
type RunDetail = Run & {
  companies: Array<{
    id: string;
    companyId: string;
    status: string;
    failureCode: string | null;
    failureMessage: string | null;
    sources: Array<{
      id: string;
      sourceKey: string;
      status: string;
      candidateCount: number;
      acceptedCount: number;
      rejectedCount: number;
      attempts: Array<{
        id: string;
        attemptNumber: number;
        stage: string;
        sourceReportedTotal: number | null;
        recordsReceived: number;
        recordsParsed: number;
        recordsEvaluable: number;
        recordsEvaluated: number;
        pagesRequested: number;
        pagesValidated: number;
        uniqueIdentities: number;
        validationStatus: string;
        failureCode: string | null;
        failureMessage: string | null;
        diagnostics: Array<{
          code: string;
          category: string;
          count: number;
          message: string;
        }>;
      }>;
    }>;
  }>;
};
function RunHistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [textFilter, setTextFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [searchTerms, setSearchTerms] = useState(
    defaultScoutSearchProfile.terms.join(", "),
  );
  const [searchLocations, setSearchLocations] = useState(
    defaultScoutSearchProfile.locations.join(", "),
  );
  const limit = 20;
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try {
      const response = await fetch("/api/gig-scout/runs", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load Scout runs.");
      const next = (await response.json()) as Run[];
      setRuns(next);
      setSelected((value) => value ?? next[0]?.id ?? null);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load Scout runs.",
      );
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected) {
      setPositions([]);
      return;
    }
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (companyFilter) query.set("company", companyFilter);
    if (textFilter) query.set("text", textFilter);
    void fetch(
      `/api/gig-scout/runs/${encodeURIComponent(selected)}/positions?${query}`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((page: { items: Position[]; total: number }) => {
        setPositions(page.items);
        setTotal(page.total);
      })
      .catch(() => setError("Could not load Scout positions."));
    void fetch(`/api/gig-scout/runs/${encodeURIComponent(selected)}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((value: RunDetail) => setDetail(value))
      .catch(() => setError("Could not load Scout diagnostics."));
  }, [selected, runs, companyFilter, textFilter, offset]);
  const start = async () => {
    const profileValues = (value: string) =>
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const response = await fetch("/api/gig-scout/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        searchProfile: {
          terms: profileValues(searchTerms),
          locations: profileValues(searchLocations),
        },
      }),
    });
    if (!response.ok) {
      setError("Could not start the Scout run.");
      return;
    }
    const result = (await response.json()) as { run: Run };
    setSelected(result.run.id);
    await refresh();
  };
  return (
    <section className="scout-page" aria-labelledby="scout-title">
      <div className="scout-heading">
        <div>
          <p className="eyebrow">Official career sources</p>
          <h2 id="scout-title">Gig Scout</h2>
        </div>
        <div>
          <label>
            Search terms{" "}
            <input
              value={searchTerms}
              onChange={(event) => setSearchTerms(event.target.value)}
              placeholder="Comma-separated"
            />
          </label>
          <label>
            Search locations{" "}
            <input
              value={searchLocations}
              onChange={(event) => setSearchLocations(event.target.value)}
              placeholder="Comma-separated"
            />
          </label>
          <button type="button" onClick={() => void start()}>
            Start full scan
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {runs === null ? (
        <p role="status">Loading Scout history…</p>
      ) : runs.length === 0 ? (
        <p>No Scout runs yet.</p>
      ) : (
        <>
          <label>
            Historical run{" "}
            <select
              value={selected ?? ""}
              onChange={(event) => setSelected(event.target.value)}
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.status} · {new Date(run.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {runs
            .filter((run) => run.id === selected)
            .map((run) => (
              <div className="scout-summary" key={run.id} role="status">
                <strong>{run.status}</strong>
                <span>{run.succeededCount} succeeded</span>
                <span>{run.failedCount} failed</span>
                <span>{run.companyCount} companies</span>
              </div>
            ))}
          {detail && (
            <div className="scout-summary" aria-label="Run search profile">
              <span>Titles: {detail.searchProfile.terms.join(", ")}</span>
              <span>
                Locations: {detail.searchProfile.locations.join(", ")}
              </span>
            </div>
          )}
          <div className="scout-filters">
            <label>
              Company{" "}
              <input
                value={companyFilter}
                onChange={(event) => {
                  setCompanyFilter(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              Title or location{" "}
              <input
                value={textFilter}
                onChange={(event) => {
                  setTextFilter(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
          </div>
          {detail && (
            <details>
              <summary>Company diagnostics</summary>
              {detail.companies.map((company) => (
                <div key={company.id}>
                  <strong>
                    {company.companyId}: {company.status}
                  </strong>
                  {company.failureMessage && <p>{company.failureMessage}</p>}
                  <ul>
                    {company.sources.map((source) => (
                      <li key={source.id}>
                        {source.sourceKey}: {source.status} ·{" "}
                        {source.acceptedCount}/{source.candidateCount} accepted
                        · {source.rejectedCount} rejected
                        {source.attempts.map((attempt) => (
                          <span key={attempt.attemptNumber}>
                            {" "}
                            · attempt {attempt.attemptNumber} {attempt.stage}:
                            reported {attempt.sourceReportedTotal ?? "unknown"},
                            received {attempt.recordsReceived}, parsed{" "}
                            {attempt.recordsParsed}, evaluable{" "}
                            {attempt.recordsEvaluable}, evaluated{" "}
                            {attempt.recordsEvaluated}, pages{" "}
                            {attempt.pagesValidated}/{attempt.pagesRequested},
                            unique {attempt.uniqueIdentities}:{" "}
                            {attempt.validationStatus}
                            {attempt.failureCode
                              ? ` (${attempt.failureCode})`
                              : ""}
                            {attempt.diagnostics.map((diagnostic) => (
                              <span key={`${diagnostic.code}-${diagnostic.category}`}>
                                {" "}
                                · {diagnostic.code} ({diagnostic.count}):{" "}
                                {diagnostic.message}
                              </span>
                            ))}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}
          {positions.length === 0 ? (
            <p>No positions were observed for this run.</p>
          ) : (
            <div className="scout-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Source status</th>
                    <th>Description</th>
                    <th>Provenance</th>
                    <th>Observed</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.id}>
                      <td>
                        <a
                          href={position.canonicalUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {position.title}
                        </a>
                      </td>
                      <td>{position.company}</td>
                      <td>{position.location ?? "—"}</td>
                      <td>{position.sourceStatus}</td>
                      <td>
                        {position.descriptionArtifactId
                          ? "Captured"
                          : "Not provided"}
                      </td>
                      <td>
                        {position.provenance.sourceUrl ? (
                          <a
                            href={position.provenance.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {position.provenance.sourceKey ?? "Source"}
                          </a>
                        ) : (
                          (position.provenance.sourceKey ?? "—")
                        )}
                      </td>
                      <td>{new Date(position.observedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav aria-label="Scout result pages">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span>
              {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)}{" "}
              of {total}
            </span>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

function RelevanceSettings(){
 const[criteria,setCriteria]=useState(""),[threshold,setThreshold]=useState(0.85),[version,setVersion]=useState<number|null>(null),[message,setMessage]=useState<string|null>(null);
 useEffect(()=>{void fetch("/api/gig-scout/settings/relevance",{cache:"no-store"}).then(response=>response.json()).then(value=>{setCriteria(value.criteria);setThreshold(value.confidenceThreshold);setVersion(value.version);});},[]);
 const save=async()=>{const response=await fetch("/api/gig-scout/settings/relevance",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({criteria,confidenceThreshold:threshold})});if(!response.ok){setMessage("Could not save relevance criteria.");return;}const value=await response.json();setVersion(value.version);setMessage("Relevance criteria saved.");};
 return <details><summary>Relevance criteria {version?`(v${version})`:""}</summary><label>Technology-role relevance criteria <textarea value={criteria} onChange={event=>setCriteria(event.target.value)} /></label><label>Definitive-failure confidence threshold <input type="number" min="0" max="1" step="0.01" value={threshold} onChange={event=>setThreshold(Number(event.target.value))}/></label><button type="button" onClick={()=>void save()}>Save criteria version</button>{message&&<p role="status">{message}</p>}</details>;
}

type WorkspacePosition={id:string;title:string;company:string;location:string|null;canonicalUrl:string;state:string;stateRevision:number;processingStage:string|null;processingStatus:string|null;processingFailureMessage:string|null;descriptionAvailable:boolean;firstSeenAt:string;lastSeenAt:string;observationCount:number;score:number|null;scoreExplanation:string|null;criteriaVersion:number|null;rubricVersion:number|null;profileVersion:string|null;model:string|null;provider:string|null};
type WorkspaceDetail=WorkspacePosition&{descriptionId:string|null;descriptionMarkdown:string|null;descriptionSourceUrl:string|null;descriptionRetrievedAt:string|null;descriptionProvenance:unknown;relevanceEvaluationId:string|null;relevanceReason:string|null;candidateMatchEvaluationId:string|null;observations:Array<{id:string;runId:string;sourceKey:string;sourceStatus:string;title:string;canonicalUrl:string;location:string|null;observedAt:string;descriptionAvailable:boolean}>};
function PositionsWorkspace(){
 const [items,setItems]=useState<WorkspacePosition[]>([]),[state,setState]=useState("needs_user_review"),[sort,setSort]=useState("last_seen"),[company,setCompany]=useState(""),[text,setText]=useState(""),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[counts,setCounts]=useState<Record<string,number>>({}),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<WorkspaceDetail|null>(null),[note,setNote]=useState(""),[reviewAt,setReviewAt]=useState("");const limit=20;
 useEffect(()=>{const controller=new AbortController(),query=new URLSearchParams({state,offset:String(offset),limit:String(limit),sort,direction:"desc"});if(company)query.set("company",company);if(text)query.set("text",text);setLoading(true);fetch(`/api/gig-scout/positions?${query}`,{cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("Could not load Scout positions.");return response.json();}).then((page:{items:WorkspacePosition[];total:number;counts:Record<string,number>})=>{setItems(page.items);setTotal(page.total);setCounts(page.counts);setError(null);}).catch(reason=>{if(reason instanceof Error&&reason.name!=="AbortError")setError(reason.message);}).finally(()=>setLoading(false));return()=>controller.abort();},[state,sort,company,text,offset]);
 useEffect(()=>{if(!selected){setDetail(null);return;}fetch(`/api/gig-scout/positions/${encodeURIComponent(selected)}`,{cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("Could not load position history.");return response.json();}).then(setDetail).catch(()=>setError("Could not load position history."));},[selected]);
 const retryPromotion=async()=>{if(!detail)return;const response=await fetch(`/api/gig-scout/positions/${encodeURIComponent(detail.id)}/promotion/retry`,{method:"POST"});const outcome=await response.json() as (WorkspaceDetail&{promotionStatus?:string;promotionFailureMessage?:string})|null;if(outcome?.promotionStatus==="failed"){setDetail(outcome);setError(outcome.promotionFailureMessage??"Promotion retry failed.");return;}setItems(values=>values.filter(value=>value.id!==detail.id));setSelected(null);};
 const promotion=detail as (WorkspaceDetail&{promotionStatus?:string;promotionFailureMessage?:string})|null;
 if(detail&&promotion?.promotionStatus==="failed")return <aside className="scout-position-detail"><button type="button" onClick={()=>setSelected(null)}>Back to positions</button><h3>{detail.title}</h3><p role="alert">{promotion.promotionFailureMessage??"Promotion failed."}</p><button type="button" onClick={()=>void retryPromotion()}>Retry promotion</button></aside>;
 const decide=async(action:"irrelevant"|"defer"|"pursue")=>{if(!detail?.descriptionId||!detail.relevanceEvaluationId||!detail.candidateMatchEvaluationId)return;const response=await fetch(`/api/gig-scout/positions/${encodeURIComponent(detail.id)}/decision`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({changeId:`change_${crypto.randomUUID()}`,action,note:note||undefined,reviewAt:action==="defer"?new Date(reviewAt).toISOString():undefined,expectedStateRevision:detail.stateRevision,descriptionId:detail.descriptionId,relevanceEvaluationId:detail.relevanceEvaluationId,candidateMatchEvaluationId:detail.candidateMatchEvaluationId})});if(!response.ok){const value=await response.json() as {error?:string};setError(value.error??"Could not save position decision.");return;}const outcome=await response.json() as (WorkspaceDetail&{promotionStatus?:string;promotionFailureMessage?:string})|null;if(outcome?.promotionStatus==="failed"){setDetail(outcome);setError(outcome.promotionFailureMessage??"Promotion failed. Retry is available.");return;}setItems(values=>values.filter(value=>value.id!==detail.id));setTotal(value=>Math.max(0,value-1));setSelected(null);setNote("");};
 if(detail)return <aside className="scout-position-detail" aria-labelledby="position-detail-title"><button type="button" onClick={()=>setSelected(null)}>Back to positions</button><h3 id="position-detail-title">{detail.title}</h3><p>{detail.company} · {detail.location??"Location not listed"}</p><p><a href={detail.canonicalUrl} target="_blank" rel="noreferrer">Official posting</a> · first seen {new Date(detail.firstSeenAt).toLocaleDateString()} · last seen {new Date(detail.lastSeenAt).toLocaleDateString()}</p><section aria-label="Review decision"><h4>Your decision</h4><label>Private note (optional)<textarea value={note} maxLength={2000} onChange={event=>setNote(event.target.value)}/></label><div><button type="button" onClick={()=>void decide("pursue")}>Pursue</button><button type="button" onClick={()=>void decide("irrelevant")}>Mark irrelevant</button></div><label>Review again at <input type="datetime-local" value={reviewAt} onChange={event=>setReviewAt(event.target.value)}/></label><button type="button" disabled={!reviewAt} onClick={()=>void decide("defer")}>Defer</button></section>{error&&<p role="alert">{error}</p>}<section><h4>Agent assessment</h4><p><strong>Relevance:</strong> {detail.relevanceReason??"No reason available"}</p><p><strong>Candidate-match score:</strong> {detail.score??"—"}/10</p>{detail.scoreExplanation&&<p>{detail.scoreExplanation}</p>}</section><section><h4>Official description</h4><p>Retrieved {detail.descriptionRetrievedAt?new Date(detail.descriptionRetrievedAt).toLocaleString():"—"} from <a href={detail.descriptionSourceUrl??detail.canonicalUrl} target="_blank" rel="noreferrer">the official source</a>.</p><pre className="scout-description-markdown">{detail.descriptionMarkdown??"Description unavailable."}</pre></section><details><summary>Processing diagnostics and observation history</summary><p>{detail.processingStage?.replaceAll("_"," ")??"No active stage"} · {detail.processingStatus??"—"}</p>{detail.processingFailureMessage&&<p role="alert">{detail.processingFailureMessage}</p>}<ul>{detail.observations.map(observation=><li key={observation.id}><a href={observation.canonicalUrl} target="_blank" rel="noreferrer">{observation.title}</a> · {observation.sourceKey} · {observation.sourceStatus} · {new Date(observation.observedAt).toLocaleString()}</li>)}</ul></details></aside>;
 const states=["actionable","processing","needs_user_review","deferred"];
 // @ts-expect-error The prior inline detail branch is unreachable after the focused review return.
 return <section aria-labelledby="positions-title"><h3 id="positions-title">Positions</h3><p>One cross-run workspace for official positions that still need attention.</p><RelevanceSettings/>{error&&<p role="alert">{error}</p>}<div className="scout-filters"><label>View <select value={state} onChange={event=>{setState(event.target.value);setOffset(0);}}>{states.map(value=><option key={value} value={value}>{value.replaceAll("_"," ")} ({counts[value]??0})</option>)}</select></label><label>Sort <select value={sort} onChange={event=>{setSort(event.target.value);setOffset(0);}}><option value="last_seen">Last seen</option><option value="score">Candidate-match score</option><option value="company">Company</option><option value="title">Title</option></select></label><label>Company <input value={company} onChange={event=>{setCompany(event.target.value);setOffset(0);}} /></label><label>Search <input value={text} onChange={event=>{setText(event.target.value);setOffset(0);}} /></label></div>{loading?<p role="status">Loading positions…</p>:items.length===0?<p>No positions match the active filters.</p>:<div className="scout-table-wrap"><table><thead><tr><th>Title</th><th>Company</th><th>Location</th><th>Score</th><th>State</th><th>Processing</th><th>Description</th><th>Seen</th><th>Observations</th></tr></thead><tbody>{items.map(position=><tr key={position.id}><td><button className="link-button" type="button" onClick={()=>setSelected(position.id)}>{position.title}</button><br/><a href={position.canonicalUrl} target="_blank" rel="noreferrer">Official posting</a></td><td>{position.company}</td><td>{position.location??"—"}</td><td>{position.score??"—"}</td><td>{position.state.replaceAll("_"," ")}</td><td>{position.processingStage?.replaceAll("_"," ")??"—"} · {position.processingStatus??"—"}{position.processingFailureMessage&&<span role="alert"> · {position.processingFailureMessage}</span>}</td><td>{position.descriptionAvailable?"Available":"Not available"}</td><td>{new Date(position.firstSeenAt).toLocaleDateString()} – {new Date(position.lastSeenAt).toLocaleDateString()}</td><td>{position.observationCount}</td></tr>)}</tbody></table></div>}<nav aria-label="Position pages"><button type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</button><span>{total===0?0:offset+1}–{Math.min(offset+limit,total)} of {total}</span><button type="button" disabled={offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Next</button></nav>{detail&&<aside className="scout-position-detail" aria-labelledby="position-detail-title"><button type="button" onClick={()=>setSelected(null)}>Close</button><h4 id="position-detail-title">{detail.title}</h4><p>{detail.company} · {detail.state.replaceAll("_"," ")}</p>{detail.score!==null&&<><p><strong>Candidate-match score:</strong> {detail.score}/10</p>{detail.scoreExplanation&&<p><strong>Score explanation:</strong> {detail.scoreExplanation}</p>}<p>Criteria v{detail.criteriaVersion??"—"} · rubric v{detail.rubricVersion??"—"} · profile {detail.profileVersion??"—"} · {detail.provider??"—"}/{detail.model??"—"}</p></>}<h5>Observation history</h5><ul>{detail.observations.map(observation=><li key={observation.id}><a href={observation.canonicalUrl} target="_blank" rel="noreferrer">{observation.title}</a> · {observation.sourceKey} · {observation.sourceStatus} · run {observation.runId} · {new Date(observation.observedAt).toLocaleString()}</li>)}</ul></aside>}</section>;
}

export function GigScoutPage(){const[view,setView]=useState<"positions"|"runs">("positions");return <section className="scout-page" aria-labelledby="scout-workspace-title"><div className="scout-heading"><div><p className="eyebrow">Official career sources</p><h2 id="scout-workspace-title">Gig Scout</h2></div></div><nav aria-label="Gig Scout views"><button type="button" aria-current={view==="positions"?"page":undefined} onClick={()=>setView("positions")}>Positions</button><button type="button" aria-current={view==="runs"?"page":undefined} onClick={()=>setView("runs")}>Run history</button></nav>{view==="positions"?<PositionsWorkspace/>:<RunHistoryPage/>}</section>}
