import { useEffect, useState } from "react";
type Run = {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  companyCount: number;
  succeededCount: number;
  failedCount: number;
};
type Position = {
  id: string;
  title: string;
  company: string;
  canonicalUrl: string;
  location: string | null;
  observedAt: string;
  sourceStatus: string;
};
export function GigScoutPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
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
    void fetch(
      `/api/gig-scout/runs/${encodeURIComponent(selected)}/positions?limit=100`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((page: { items: Position[] }) => setPositions(page.items))
      .catch(() => setError("Could not load Scout positions."));
  }, [selected, runs]);
  const start = async () => {
    const response = await fetch("/api/gig-scout/runs", { method: "POST" });
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
        <button type="button" onClick={() => void start()}>
          Start full scan
        </button>
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
                      <td>{new Date(position.observedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
