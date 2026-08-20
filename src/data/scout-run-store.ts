import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CompanyScanResult,
  NormalizedPosition,
  ScoutSearchProfile,
  SourceConfiguration,
} from "../core/scout/engine";
import type {
  ScoutCompanyJob,
  ScoutPositionPage,
  ScoutRunDetail,
  ScoutRunStore,
  ScoutRunSummary,
} from "../core/scout/engine/runs";
const id = (kind: string, ...parts: string[]) =>
  `${kind}_${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32)}`;
const summary = (row: Record<string, unknown>): ScoutRunSummary => ({
  id: String(row.id),
  status: row.status as ScoutRunSummary["status"],
  batchSize: Number(row.batch_size),
  concurrency: Number(row.concurrency),
  createdAt: String(row.created_at),
  startedAt: typeof row.started_at === "string" ? row.started_at : null,
  completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  companyCount: Number(row.company_count),
  succeededCount: Number(row.succeeded_count),
  failedCount: Number(row.failed_count),
  searchProfile: JSON.parse(String(row.search_profile_json)),
});
export class SqliteScoutRunStore implements ScoutRunStore {
  constructor(
    private readonly db: Database,
    private readonly descriptionsRoot?: string,
  ) {}
  startOrReuse(
    batchSize: number,
    concurrency: number,
    now: string,
    searchProfile: ScoutSearchProfile = { terms: [], locations: [] },
  ) {
    return this.db.transaction(() => {
      const active = this.db
        .query(
          `SELECT * FROM scout_runs WHERE run_type='full' AND status IN ('queued','running') LIMIT 1`,
        )
        .get() as Record<string, unknown> | null;
      if (active) return { run: summary(active), created: false };
      const runId = `srun_${crypto.randomUUID()}`;
      const companies = this.db
        .query(
          `SELECT id,current_configuration_id FROM scout_companies WHERE active=1 ORDER BY id`,
        )
        .all() as Array<{ id: string; current_configuration_id: string }>;
      this.db
        .query(
          `INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at,company_count,search_profile_json) VALUES(?,'queued',?,?,?,?,?)`,
        )
        .run(
          runId,
          batchSize,
          concurrency,
          now,
          companies.length,
          JSON.stringify(searchProfile),
        );
      for (const company of companies) {
        const runCompanyId = id("src", runId, company.id);
        this.db
          .query(
            `INSERT INTO scout_run_companies(id,run_id,company_id,company_configuration_id,status) VALUES(?,?,?,?,'queued')`,
          )
          .run(
            runCompanyId,
            runId,
            company.id,
            company.current_configuration_id,
          );
        this.db
          .query(
            `INSERT INTO scout_run_outbox(id,run_company_id,queue_job_id,created_at) VALUES(?,?,?,?)`,
          )
          .run(
            id("sout", runCompanyId),
            runCompanyId,
            id("sjob", runCompanyId),
            now,
          );
      }
      if (!companies.length)
        this.db
          .query(
            `UPDATE scout_runs SET status='completed',started_at=?,completed_at=? WHERE id=?`,
          )
          .run(now, now, runId);
      return {
        run: this.list().find((run) => run.id === runId)!,
        created: true,
      };
    })();
  }
  list() {
    return (
      this.db
        .query(`SELECT * FROM scout_runs ORDER BY created_at DESC,id DESC`)
        .all() as Record<string, unknown>[]
    ).map(summary);
  }
  get(runId: string): ScoutRunDetail | null {
    const run = this.db
      .query(`SELECT * FROM scout_runs WHERE id=?`)
      .get(runId) as Record<string, unknown> | null;
    if (!run) return null;
    const companies = this.db
      .query(
        `SELECT id,company_id companyId,status,failure_code failureCode,failure_message failureMessage FROM scout_run_companies WHERE run_id=? ORDER BY company_id`,
      )
      .all(runId) as Array<
      Omit<ScoutRunDetail["companies"][number], "sources">
    >;
    return {
      ...summary(run),
      companies: companies.map((company) => {
        const sources = this.db
          .query(
            `SELECT rs.id,s.source_key sourceKey,rs.status,rs.candidate_count candidateCount,rs.accepted_count acceptedCount,rs.rejected_count rejectedCount FROM scout_run_sources rs JOIN scout_company_configuration_sources s ON s.id=rs.configuration_source_id WHERE rs.run_company_id=? ORDER BY s.source_key`,
          )
          .all(company.id) as Array<
          Omit<
            ScoutRunDetail["companies"][number]["sources"][number],
            "attempts"
          >
        >;
        return {
          ...company,
          sources: sources.map((source) => ({
            ...source,
            attempts: (this.db
              .query(
                `SELECT id,attempt_number attemptNumber,stage,source_reported_total sourceReportedTotal,records_received recordsReceived,records_parsed recordsParsed,records_evaluable recordsEvaluable,records_evaluated recordsEvaluated,pages_requested pagesRequested,pages_validated pagesValidated,unique_identities uniqueIdentities,validation_status validationStatus,failure_code failureCode,failure_message failureMessage FROM scout_source_attempts WHERE run_source_id=? ORDER BY attempt_number`,
              )
              .all(source.id) as Array<
              Omit<
                ScoutRunDetail["companies"][number]["sources"][number]["attempts"][number],
                "diagnostics"
              >
            >).map((attempt) => ({
              ...attempt,
              diagnostics: this.db
                .query(
                  `SELECT code,category,count,message FROM scout_attempt_diagnostics WHERE source_attempt_id=? ORDER BY id`,
                )
                .all(attempt.id) as ScoutRunDetail["companies"][number]["sources"][number]["attempts"][number]["diagnostics"],
            })),
          })),
        };
      }),
    };
  }
  pendingJobs(limit: number) {
    return this.jobs(
      `o.dispatch_status='pending' AND rc.status='queued'`,
      limit,
    );
  }
  nonterminalJobs(limit: number) {
    return this.jobs(`rc.status='queued'`, limit);
  }
  private jobs(where: string, limit: number) {
    const rows = this.db
      .query(
        `SELECT rc.run_id,rc.id run_company_id,rc.company_id,rc.company_configuration_id,r.search_profile_json,group_concat(s.settings_json,char(30)) settings FROM scout_run_companies rc JOIN scout_runs r ON r.id=rc.run_id JOIN scout_run_outbox o ON o.run_company_id=rc.id JOIN scout_company_configuration_sources s ON s.company_configuration_id=rc.company_configuration_id AND s.active=1 WHERE ${where} GROUP BY rc.id ORDER BY o.created_at,o.id LIMIT ?`,
      )
      .all(limit) as Array<{
      run_id: string;
      run_company_id: string;
      company_id: string;
      company_configuration_id: string;
      settings: string;
      search_profile_json: string;
    }>;
    return rows.map((row) => ({
      runId: row.run_id,
      runCompanyId: row.run_company_id,
      companyId: row.company_id,
      configurationVersionId: row.company_configuration_id,
      searchProfile: JSON.parse(row.search_profile_json),
      sources: row.settings
        .split(String.fromCharCode(30))
        .map((value) => JSON.parse(value) as SourceConfiguration),
    }));
  }
  markDispatched(ids: string[], now: string) {
    const update = this.db.query(
      `UPDATE scout_run_outbox SET dispatch_status='dispatched',dispatched_at=? WHERE run_company_id=? AND dispatch_status='pending'`,
    );
    this.db.transaction(() => ids.forEach((item) => update.run(now, item)))();
  }
  private finalize(runId: string, now: string) {
    const counts = this.db
      .query(
        `SELECT count(*) total,sum(status='succeeded') succeeded,sum(status='partial') partial,sum(status='failed') failed,sum(status='queued') pending FROM scout_run_companies WHERE run_id=?`,
      )
      .get(runId) as {
      total: number;
      succeeded: number;
      partial: number;
      failed: number;
      pending: number;
    };
    const status = counts.pending
      ? "running"
      : counts.partial || (counts.failed && counts.succeeded)
        ? "partial"
        : counts.failed
          ? "failed"
          : "completed";
    this.db
      .query(
        `UPDATE scout_runs SET status=?,started_at=coalesce(started_at,?),completed_at=?,succeeded_count=?,failed_count=? WHERE id=?`,
      )
      .run(
        status,
        now,
        counts.pending ? null : now,
        counts.succeeded,
        counts.failed,
        runId,
      );
  }
  commitResult(job: ScoutCompanyJob, result: CompanyScanResult, now: string) {
    this.db.transaction(() => {
      for (const source of result.sources) {
        const configured = this.db
          .query(
            `SELECT id FROM scout_company_configuration_sources WHERE company_configuration_id=? AND source_key=?`,
          )
          .get(job.configurationVersionId, source.sourceKey) as { id: string };
        const runSourceId = id("srs", job.runCompanyId, source.sourceKey);
        const counts = source.attempts.reduce(
          (total, attempt) => ({
            candidateCount: total.candidateCount + attempt.candidateCount,
            acceptedCount: total.acceptedCount,
            rejectedCount: total.rejectedCount + attempt.rejectedCount,
          }),
          {
            candidateCount: 0,
            acceptedCount: source.positions.length,
            rejectedCount: 0,
          },
        );
        this.db
          .query(
            `INSERT OR REPLACE INTO scout_run_sources(id,run_company_id,configuration_source_id,status,candidate_count,accepted_count,rejected_count) VALUES(?,?,?,?,?,?,?)`,
          )
          .run(
            runSourceId,
            job.runCompanyId,
            configured.id,
            source.status,
            counts.candidateCount,
            counts.acceptedCount,
            counts.rejectedCount,
          );
        source.attempts.forEach((attempt, index) => {
          const attemptId = id("sat", runSourceId, String(index + 1));
          this.db
            .query(
              `INSERT OR REPLACE INTO scout_source_attempts(id,run_source_id,attempt_number,source_method,stage,request_count,response_count,source_reported_total,records_received,records_parsed,records_evaluable,records_evaluated,candidate_count,accepted_count,rejected_count,pages_requested,pages_validated,unique_identities,validation_status,started_at,completed_at,failure_code,failure_message) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              attemptId,
              runSourceId,
              index + 1,
              attempt.sourceMethod,
              attempt.stage,
              attempt.requestCount,
              attempt.responseCount,
              attempt.sourceReportedTotal ?? null,
              attempt.recordsReceived ?? 0,
              attempt.recordsParsed ?? attempt.candidateCount,
              attempt.recordsEvaluable ?? attempt.candidateCount,
              attempt.recordsEvaluated ?? attempt.candidateCount,
              attempt.candidateCount,
              attempt.acceptedCount,
              attempt.rejectedCount,
              attempt.pagesRequested ?? attempt.requestCount,
              attempt.pagesValidated ?? attempt.responseCount,
              attempt.uniqueIdentities ?? attempt.acceptedCount,
              attempt.validationStatus,
              attempt.startedAt,
              attempt.completedAt,
              attempt.failure?.code ?? null,
              attempt.failure?.message.slice(0, 500) ?? null,
            );
          attempt.diagnostics.forEach((diagnostic, dindex) =>
            this.db
              .query(
                `INSERT OR REPLACE INTO scout_attempt_diagnostics VALUES(?,?,?,?,?,?)`,
              )
              .run(
                id("sad", attemptId, String(dindex)),
                attemptId,
                diagnostic.code,
                diagnostic.category,
                diagnostic.count,
                diagnostic.message.slice(0, 500),
              ),
          );
        });
        for (const position of source.positions)
          this.observe(job, runSourceId, position, now);
      }
      const statuses = result.sources.map((source) => source.status);
      const companyStatus =
        statuses.length > 0 &&
        statuses.every((status) => status.startsWith("succeeded_"))
          ? "succeeded"
          : statuses.some(
                (status) =>
                  status.startsWith("succeeded_") || status === "partial",
              )
            ? "partial"
            : "failed";
      this.db
        .query(
          `UPDATE scout_run_companies SET status=?,completed_at=?,failure_code=?,failure_message=? WHERE id=? AND status='queued'`,
        )
        .run(
          companyStatus,
          now,
          companyStatus === "failed" ? "all_sources_failed" : null,
          companyStatus === "failed"
            ? "No configured source completed successfully."
            : null,
          job.runCompanyId,
        );
      this.finalize(job.runId, now);
    })();
  }
  private observe(
    job: ScoutCompanyJob,
    runSourceId: string,
    position: NormalizedPosition,
    now: string,
  ) {
    const identityKind = position.externalId ? "external_id" : "canonical_url";
    const identityValue = position.externalId ?? position.canonicalUrl;
    const positionId = id(
      "spos",
      job.companyId,
      position.sourceKey,
      identityValue,
    );
    const descriptionArtifactId = this.materializeDescription(position, now);
    this.db
      .query(
        `INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,external_id,canonical_url,title,location,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,source_key,identity_kind,identity_value) DO UPDATE SET canonical_url=excluded.canonical_url,title=excluded.title,location=excluded.location,last_seen_at=excluded.last_seen_at`,
      )
      .run(
        positionId,
        job.companyId,
        position.sourceKey,
        identityKind,
        identityValue,
        position.externalId,
        position.canonicalUrl,
        position.title,
        position.location,
        now,
        now,
      );
    this.db
      .query(
        `INSERT OR IGNORE INTO scout_position_observations(id,run_source_id,position_id,description_artifact_id,title,canonical_url,location,provenance_json,observed_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id("sobs", runSourceId, positionId),
        runSourceId,
        positionId,
        descriptionArtifactId,
        position.title,
        position.canonicalUrl,
        position.location,
        JSON.stringify(position.provenance),
        now,
      );
  }
  private materializeDescription(position: NormalizedPosition, now: string) {
    if (!position.description || !this.descriptionsRoot) return null;
    const content = position.description;
    const hash = createHash("sha256").update(content).digest("hex");
    const artifactId = `sdesc_${hash}`;
    const relative = path.join(hash.slice(0, 2), `${hash}.md`);
    const target = path.resolve(this.descriptionsRoot, relative);
    const root = path.resolve(this.descriptionsRoot);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new Error("Unsafe Scout description path.");
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, target);
    this.db
      .query(
        `INSERT OR IGNORE INTO scout_description_artifacts(id,file_path,content_hash,media_type,byte_count,provenance_json,created_at) VALUES(?,?,?,'text/markdown',?,?,?)`,
      )
      .run(
        artifactId,
        relative,
        hash,
        Buffer.byteLength(content),
        JSON.stringify(position.provenance),
        now,
      );
    return artifactId;
  }
  commitInfrastructureFailure(
    job: ScoutCompanyJob,
    code: string,
    message: string,
    now: string,
  ) {
    this.db.transaction(() => {
      this.db
        .query(
          `UPDATE scout_run_companies SET status='failed',completed_at=?,failure_code=?,failure_message=? WHERE id=? AND status='queued'`,
        )
        .run(now, code.slice(0, 100), message.slice(0, 500), job.runCompanyId);
      this.finalize(job.runId, now);
    })();
  }
  positions(
    runId: string,
    input: { company?: string; text?: string; offset: number; limit: number },
  ): ScoutPositionPage {
    const where = ["rc.run_id = ?"],
      params: string[] = [runId];
    if (input.company) {
      where.push("lower(c.name) LIKE ? ESCAPE '\\'");
      params.push(
        `%${input.company.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`,
      );
    }
    if (input.text) {
      where.push(
        "(lower(o.title) LIKE ? ESCAPE '\\' OR lower(coalesce(o.location,'')) LIKE ? ESCAPE '\\')",
      );
      const query = `%${input.text.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
      params.push(query, query);
    }
    const from = ` FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id JOIN scout_companies c ON c.id=rc.company_id WHERE ${where.join(" AND ")}`;
    const total = Number(
      (
        this.db.query(`SELECT count(*) count${from}`).get(...params) as {
          count: number;
        }
      ).count,
    );
    const items = this.db
      .query(
        `SELECT o.id,o.title,c.name company,o.canonical_url canonicalUrl,o.location,o.observed_at observedAt,rs.status sourceStatus,o.description_artifact_id descriptionArtifactId,o.provenance_json provenance${from} ORDER BY lower(c.name),lower(o.title),o.id LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, input.offset) as Array<
      Record<string, unknown>
    >;
    return {
      items: items.map((item) => ({
        ...item,
        provenance: JSON.parse(String(item.provenance)),
      })) as ScoutPositionPage["items"],
      offset: input.offset,
      limit: input.limit,
      total,
    };
  }
}
