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

type WorkspacePosition={id:string;title:string;company:string;location:string|null;canonicalUrl:string;state:string;processingStage:string|null;processingStatus:string|null;processingFailureMessage:string|null;descriptionAvailable:boolean;firstSeenAt:string;lastSeenAt:string;observationCount:number};
type WorkspaceDetail=WorkspacePosition&{observations:Array<{id:string;runId:string;sourceKey:string;sourceStatus:string;title:string;canonicalUrl:string;location:string|null;observedAt:string;descriptionAvailable:boolean}>};
function PositionsWorkspace(){
 const [items,setItems]=useState<WorkspacePosition[]>([]),[state,setState]=useState("actionable"),[company,setCompany]=useState(""),[text,setText]=useState(""),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[counts,setCounts]=useState<Record<string,number>>({}),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<WorkspaceDetail|null>(null);const limit=20;
 useEffect(()=>{const controller=new AbortController(),query=new URLSearchParams({state,offset:String(offset),limit:String(limit),sort:"last_seen",direction:"desc"});if(company)query.set("company",company);if(text)query.set("text",text);setLoading(true);fetch(`/api/gig-scout/positions?${query}`,{cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("Could not load Scout positions.");return response.json();}).then((page:{items:WorkspacePosition[];total:number;counts:Record<string,number>})=>{setItems(page.items);setTotal(page.total);setCounts(page.counts);setError(null);}).catch(reason=>{if(reason instanceof Error&&reason.name!=="AbortError")setError(reason.message);}).finally(()=>setLoading(false));return()=>controller.abort();},[state,company,text,offset]);
 useEffect(()=>{if(!selected){setDetail(null);return;}fetch(`/api/gig-scout/positions/${encodeURIComponent(selected)}`,{cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("Could not load position history.");return response.json();}).then(setDetail).catch(()=>setError("Could not load position history."));},[selected]);
 const states=["actionable","processing","needs_user_review","irrelevant","deferred"];
 return <section aria-labelledby="positions-title"><h3 id="positions-title">Positions</h3><p>One cross-run workspace for official positions that still need attention.</p>{error&&<p role="alert">{error}</p>}<div className="scout-filters"><label>View <select value={state} onChange={event=>{setState(event.target.value);setOffset(0);}}>{states.map(value=><option key={value} value={value}>{value.replaceAll("_"," ")} ({counts[value]??0})</option>)}</select></label><label>Company <input value={company} onChange={event=>{setCompany(event.target.value);setOffset(0);}} /></label><label>Search <input value={text} onChange={event=>{setText(event.target.value);setOffset(0);}} /></label></div>{loading?<p role="status">Loading positions…</p>:items.length===0?<p>No positions match the active filters.</p>:<div className="scout-table-wrap"><table><thead><tr><th>Title</th><th>Company</th><th>Location</th><th>State</th><th>Processing</th><th>Description</th><th>Seen</th><th>Observations</th></tr></thead><tbody>{items.map(position=><tr key={position.id}><td><button className="link-button" type="button" onClick={()=>setSelected(position.id)}>{position.title}</button><br/><a href={position.canonicalUrl} target="_blank" rel="noreferrer">Official posting</a></td><td>{position.company}</td><td>{position.location??"—"}</td><td>{position.state.replaceAll("_"," ")}</td><td>{position.processingStage?.replaceAll("_"," ")??"—"} · {position.processingStatus??"—"}{position.processingFailureMessage&&<span role="alert"> · {position.processingFailureMessage}</span>}</td><td>{position.descriptionAvailable?"Available":"Not available"}</td><td>{new Date(position.firstSeenAt).toLocaleDateString()} – {new Date(position.lastSeenAt).toLocaleDateString()}</td><td>{position.observationCount}</td></tr>)}</tbody></table></div>}<nav aria-label="Position pages"><button type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</button><span>{total===0?0:offset+1}–{Math.min(offset+limit,total)} of {total}</span><button type="button" disabled={offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Next</button></nav>{detail&&<aside className="scout-position-detail" aria-labelledby="position-detail-title"><button type="button" onClick={()=>setSelected(null)}>Close</button><h4 id="position-detail-title">{detail.title}</h4><p>{detail.company} · {detail.state.replaceAll("_"," ")}</p><h5>Observation history</h5><ul>{detail.observations.map(observation=><li key={observation.id}><a href={observation.canonicalUrl} target="_blank" rel="noreferrer">{observation.title}</a> · {observation.sourceKey} · {observation.sourceStatus} · run {observation.runId} · {new Date(observation.observedAt).toLocaleString()}</li>)}</ul></aside>}</section>;
}

export function GigScoutPage(){const[view,setView]=useState<"positions"|"runs">("positions");return <section className="scout-page" aria-labelledby="scout-workspace-title"><div className="scout-heading"><div><p className="eyebrow">Official career sources</p><h2 id="scout-workspace-title">Gig Scout</h2></div></div><nav aria-label="Gig Scout views"><button type="button" aria-current={view==="positions"?"page":undefined} onClick={()=>setView("positions")}>Positions</button><button type="button" aria-current={view==="runs"?"page":undefined} onClick={()=>setView("runs")}>Run history</button></nav>{view==="positions"?<PositionsWorkspace/>:<RunHistoryPage/>}</section>}
