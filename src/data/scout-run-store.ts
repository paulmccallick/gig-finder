import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
import type { ScoutPositionDetail,ScoutPositionProcessingJob,ScoutPositionStore,ScoutWorkspacePage } from "../core/scout/engine/positions";
import type { CandidateMatchRequest, ModelResult, RelevanceRequest, RelevanceResult, CandidateMatchResult, ScoutDescriptionInput, ScoutPositionProcessingRepository } from "../core/scout/engine/screening";
import { BoundedFetchHttpPort } from "../core/scout/sourcing/ports";
import { descriptionToMarkdown, retrieveOfficialDescription, scoutDescriptionConverterVersion } from "../core/scout/sourcing/descriptions";
const id = (kind: string, ...parts: string[]) =>
  `${kind}_${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32)}`;
const nullableText = (value: unknown) =>
  typeof value === "string" ? value : null;
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
export interface ScoutScreeningInputs {profile:unknown;profileVersion:string;profileArtifactId:string;profileHash:string;model:string;provider:string;modelConfiguration:string}
export class SqliteScoutRunStore implements ScoutRunStore,ScoutPositionStore,ScoutPositionProcessingRepository {
  constructor(
    private readonly db: Database,
    private readonly descriptionsRoot?: string,
    private readonly screening?:ScoutScreeningInputs,
    private readonly descriptionHttp=new BoundedFetchHttpPort(),
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
          `INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at,company_count,search_profile_json,screening_cache_key,candidate_profile_json,candidate_profile_version,candidate_profile_artifact_id,candidate_profile_hash) VALUES(?,'queued',?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          runId,
          batchSize,
          concurrency,
          now,
          companies.length,
          JSON.stringify(searchProfile),
          this.screening?crypto.randomUUID():null,
          this.screening?JSON.stringify(this.screening.profile):null,
          this.screening?.profileVersion??null,
          this.screening?.profileArtifactId??null,
          this.screening?.profileHash??null,
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
      if(companyStatus==="succeeded")this.reconcileCompanyAvailability(job,now);
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
    this.initializePosition(positionId,now);
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
    const observationId=id("sobs", runSourceId, positionId);
    this.ensurePositionProcessing(positionId,now,{runId:job.runId,observationId});
    this.ensureCurrentRelevance(positionId,now,{runId:job.runId,observationId});
  }
  private processingInputIdentity(positionId:string,observationId?:string){
    const row=this.db.query(`SELECT p.company_id,p.external_id,coalesce(o.canonical_url,p.canonical_url) canonical_url,o.title,o.location,c.name company FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id LEFT JOIN scout_position_observations o ON o.id=? WHERE p.id=?`).get(observationId??null,positionId) as {external_id:string|null;canonical_url:string;title:string|null;location:string|null;company:string}|null;
    if(!row)return "missing";
    const gigs=this.db.query(`SELECT id,company,external_job_id,source_url,revision,is_deleted FROM gigs WHERE lower(trim(company))=lower(trim(?)) AND is_deleted=0 ORDER BY id`).all(row.company) as Array<Record<string,unknown>>;
    return createHash("sha256").update(JSON.stringify({externalId:row.external_id,url:row.canonical_url,title:row.title,location:row.location,gigs})).digest("hex");
  }
  private initializePosition(positionId:string,now:string){
    const changeId=id("change","scout-position-init",positionId);
    this.db.query(`INSERT OR IGNORE INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,'Gig Scout','automation','Initialized Scout position state','committed')`).run(changeId,now);
    const created=this.db.query(`INSERT OR IGNORE INTO scout_position_states(position_id,state,revision,created_at,updated_at) VALUES(?,'processing',1,?,?)`).run(positionId,now,now).changes>0;
    if(created)this.db.query(`INSERT INTO scout_position_state_history(change_id,operation,recorded_at,recorded_by,position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at) SELECT ?,'create',?,'Gig Scout',position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at FROM scout_position_states WHERE position_id=?`).run(changeId,now,positionId);
  }
  private ensurePositionProcessing(positionId:string,now:string,bindings:{runId?:string;observationId?:string}={}){
    const inputIdentity=this.processingInputIdentity(positionId,bindings.observationId),processingId=id("spp",positionId,"reconcile_gig",inputIdentity);
    this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage='reconcile_gig' AND status IN ('pending','failed') AND input_identity<>?`).run(now,positionId,inputIdentity);
    const inserted=this.db.query(`INSERT OR IGNORE INTO scout_position_processing(id,position_id,run_id,observation_id,stage,input_identity,status,created_at,updated_at) VALUES(?,?,?,?,'reconcile_gig',?,'pending',?,?)`).run(processingId,positionId,bindings.runId??null,bindings.observationId??null,inputIdentity,now,now).changes>0;
    if(inserted)this.db.query(`INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,created_at) VALUES(?,?,?,?)`).run(id("sppo",processingId),processingId,`position:${processingId}`,now);
    const revived=!inserted&&this.db.query(`UPDATE scout_position_processing SET run_id=?,observation_id=?,status='pending',attempt_count=0,failure_code=NULL,failure_message=NULL,updated_at=?,completed_at=NULL WHERE id=? AND status IN ('failed','superseded')`).run(bindings.runId??null,bindings.observationId??null,now,processingId).changes>0;
    if(revived)this.db.query(`UPDATE scout_position_processing_outbox SET dispatch_status='pending',dispatched_at=NULL WHERE processing_id=?`).run(processingId);
    if(!inserted&&!revived){const current=this.db.query(`SELECT s.linked_gig_id linkedGigId,x.status FROM scout_position_states s JOIN scout_position_processing x ON x.position_id=s.position_id AND x.stage='reconcile_gig' AND x.input_identity=? WHERE s.position_id=?`).get(inputIdentity,positionId) as {linkedGigId:string|null;status:string}|null;if(current?.status==="completed"&&!current.linkedGigId)this.ensureStage(positionId,"acquire_description",this.descriptionIdentity(positionId,bindings.observationId),now,bindings);}
    return inserted||revived;
  }
  private reconcileCompanyAvailability(job:ScoutCompanyJob,now:string){
    const company=this.db.query(`SELECT name FROM scout_companies WHERE id=?`).get(job.companyId) as {name:string}|null;if(!company)return;
    const gigs=this.db.query(`SELECT id,revision,scout_availability,source_url,external_job_id FROM gigs WHERE is_deleted=0 AND lower(trim(company))=lower(trim(?))`).all(company.name) as Array<{id:string;revision:number;scout_availability:string;source_url:string|null;external_job_id:string|null}>;
    for(const gig of gigs){if(!gig.source_url&&!gig.external_job_id)continue;const observed=this.db.query(`SELECT 1 FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id JOIN scout_positions p ON p.id=o.position_id WHERE rc.run_id=? AND rc.company_id=? AND ((? IS NOT NULL AND p.canonical_url=?) OR (? IS NOT NULL AND p.external_id=?)) LIMIT 1`).get(job.runId,job.companyId,gig.source_url,gig.source_url,gig.external_job_id,gig.external_job_id);const availability=observed?"available":"unavailable";if(gig.scout_availability!==availability){const changeId=id("change","scout-availability",job.runId,gig.id);this.db.query(`INSERT OR IGNORE INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,'Gig Scout','automation','Reconciled tracked Gig availability','committed')`).run(changeId,now);this.db.query(`INSERT OR IGNORE INTO scout_gig_availability_history(change_id,gig_id,prior_availability,availability,recorded_at,recorded_by,run_id) VALUES(?,?,?,?,?,'Gig Scout',?)`).run(changeId,gig.id,gig.scout_availability,availability,now,job.runId);this.db.query(`UPDATE gigs SET scout_availability=?,scout_availability_updated_at=?,updated_at=?,revision=revision+1 WHERE id=?`).run(availability,now,now,gig.id);}}
  }
  pendingPositionJobs(limit:number){return this.db.query(`SELECT p.id,p.id processingId,p.position_id positionId,p.stage,p.input_identity inputIdentity,p.attempt_count attemptCount FROM scout_position_processing p JOIN scout_position_processing_outbox o ON o.processing_id=p.id WHERE p.status='pending' ORDER BY CASE p.stage WHEN 'reconcile_gig' THEN 0 WHEN 'acquire_description' THEN 1 WHEN 'screen_relevance' THEN 2 ELSE 3 END,o.created_at,o.id LIMIT ?`).all(limit) as ScoutPositionProcessingJob[];}
  markPositionJobsDispatched(ids:string[],now:string){const q=this.db.query(`UPDATE scout_position_processing_outbox SET dispatch_status='dispatched',dispatched_at=? WHERE processing_id=?`);this.db.transaction(()=>ids.forEach(value=>q.run(now,value)))();}
  reconcileGig(processing:string|ScoutPositionProcessingJob,now:string){const processingId=typeof processing==="string"?processing:(processing.processingId??processing.id);this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,observation_id observationId FROM scout_position_processing WHERE id=? AND stage='reconcile_gig' AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;observationId:string|null}|null;if(!work)return;const position=this.db.query(`SELECT o.canonical_url canonicalUrl,p.external_id externalId,c.name company FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_observations o ON o.id=? AND o.position_id=p.id WHERE p.id=?`).get(work.observationId,work.positionId) as {canonicalUrl:string;externalId:string|null;company:string}|null;if(!position)throw new Error("Scout position not found.");const matches=this.db.query(`SELECT id FROM gigs WHERE is_deleted=0 AND ((source_url IS NOT NULL AND source_url=?) OR (external_job_id IS NOT NULL AND external_job_id=? AND lower(trim(company))=lower(trim(?)))) ORDER BY id`).all(position.canonicalUrl,position.externalId,position.company) as Array<{id:string}>;const unique=[...new Set(matches.map(match=>match.id))];const matchId=unique[0];if(unique.length===1&&matchId){const current=this.db.query(`SELECT * FROM scout_position_states WHERE position_id=?`).get(work.positionId) as Record<string,unknown>;if(current.state!=="promoted"||current.linked_gig_id!==matchId){const changeId=`change_${crypto.randomUUID()}`;this.db.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,'Gig Scout','automation','Promoted exact-matched Scout position','committed')`).run(changeId,now);this.db.query(`INSERT INTO scout_position_state_history(change_id,operation,recorded_at,recorded_by,position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at) SELECT ?,'update',?,'Gig Scout',position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at FROM scout_position_states WHERE position_id=?`).run(changeId,now,work.positionId);this.db.query(`UPDATE scout_position_states SET state='promoted',linked_gig_id=?,deferred_until=NULL,revision=revision+1,updated_at=? WHERE position_id=?`).run(matchId,now,work.positionId);}}else this.ensureStage(work.positionId,"acquire_description",this.descriptionIdentity(work.positionId,work.observationId??undefined),now,{runId:work.runId??undefined,observationId:work.observationId??undefined});this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,failure_code=NULL,failure_message=NULL,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(now,now,processingId);})();}
  failPositionProcessing(processing:string|ScoutPositionProcessingJob,code:string,message:string,now:string){const processingId=typeof processing==="string"?processing:(processing.processingId??processing.id);this.db.query(`UPDATE scout_position_processing SET status='failed',attempt_count=3,failure_code=?,failure_message=?,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(code.slice(0,100),message.slice(0,500),now,now,processingId);}
  backfillPositions(sourceRunId:string,limit:number,now:string){return this.db.transaction(()=>{if(!this.db.query(`SELECT 1 FROM scout_runs WHERE id=?`).get(sourceRunId))throw new Error("Scout backfill source run not found.");const checkpointName=`reconcile_gig:${sourceRunId}`,gigIdentitySignature=createHash("sha256").update(JSON.stringify(this.db.query(`SELECT company,external_job_id,source_url,is_deleted FROM gigs ORDER BY id`).all())).digest("hex");const checkpoint=this.db.query(`SELECT last_position_id,gig_identity_signature,completed_at FROM scout_position_backfill WHERE name=? AND source_run_id=?`).get(checkpointName,sourceRunId) as {last_position_id:string|null;gig_identity_signature:string|null;completed_at:string|null}|null;const identityChanged=Boolean(checkpoint?.gig_identity_signature&&checkpoint.gig_identity_signature!==gigIdentitySignature),startAfter=identityChanged?"":(checkpoint?.last_position_id??"");const eligible=` FROM scout_positions p JOIN scout_position_observations selected_observation ON selected_observation.id=(SELECT o.id FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE o.position_id=p.id AND rc.run_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 1) WHERE p.id>?`;if(checkpoint?.completed_at&&!identityChanged){for(const row of this.db.query(`SELECT p.id,selected_observation.id observationId${eligible} ORDER BY p.id LIMIT ?`).all(sourceRunId,"",limit) as Array<{id:string;observationId:string}>)this.ensureCurrentRelevance(row.id,now,{runId:sourceRunId,observationId:row.observationId});return{created:0,complete:true};}const rows=this.db.query(`SELECT p.id,selected_observation.id observationId${eligible} ORDER BY p.id LIMIT ?`).all(sourceRunId,startAfter,limit) as Array<{id:string;observationId:string}>;let created=0;for(const row of rows){this.initializePosition(row.id,now);const bindings={runId:sourceRunId,observationId:row.observationId};if(this.ensurePositionProcessing(row.id,now,bindings))created++;this.ensureCurrentRelevance(row.id,now,bindings);}const complete=rows.length<limit,last=rows.at(-1)?.id??(identityChanged?null:checkpoint?.last_position_id??null);this.db.query(`INSERT INTO scout_position_backfill(name,source_run_id,last_position_id,gig_identity_signature,completed_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET source_run_id=excluded.source_run_id,last_position_id=excluded.last_position_id,gig_identity_signature=excluded.gig_identity_signature,completed_at=excluded.completed_at,updated_at=excluded.updated_at`).run(checkpointName,sourceRunId,last,gigIdentitySignature,complete?now:null,now);return{created,complete};})();}
  stage(processingId:string){const row=this.db.query(`SELECT stage FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {stage:ReturnType<ScoutPositionProcessingRepository["stage"]>}|null;return row?.stage??null;}
  private ensureStage(positionId:string,stage:"acquire_description"|"screen_relevance"|"score_candidate_match",inputIdentity:string,now:string,bindings:{runId?:string;observationId?:string;descriptionId?:string;criteriaId?:string;relevanceEvaluationId?:string;rubricId?:string}={}){
    const processingId=id("spp",positionId,stage,inputIdentity);this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage=? AND status IN ('pending','failed') AND input_identity<>?`).run(now,positionId,stage,inputIdentity);
    const inserted=this.db.query(`INSERT OR IGNORE INTO scout_position_processing(id,position_id,run_id,observation_id,description_id,criteria_id,relevance_evaluation_id,rubric_id,stage,input_identity,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(processingId,positionId,bindings.runId??null,bindings.observationId??null,bindings.descriptionId??null,bindings.criteriaId??null,bindings.relevanceEvaluationId??null,bindings.rubricId??null,stage,inputIdentity,now,now).changes>0;
    if(inserted)this.db.query(`INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,created_at) VALUES(?,?,?,?)`).run(id("sppo",processingId),processingId,`position:${processingId}`,now);return processingId;
  }
  private ensureCurrentRelevance(positionId:string,now:string,bindings:{runId?:string;observationId?:string}={}){if(!this.screening)return;const context=bindings.runId&&bindings.observationId?bindings:this.db.query(`SELECT rc.run_id runId,o.id observationId FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE o.position_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`).get(positionId) as {runId:string;observationId:string}|null;if(!context?.runId||!context.observationId)return;const row=this.db.query(`SELECT d.id descriptionId,d.markdown_content_hash descriptionHash,rc.id criteriaId,rc.version criteriaVersion,rc.prompt_version promptVersion,o.title,o.location,o.canonical_url officialUrl FROM scout_position_descriptions d JOIN scout_relevance_criteria rc ON rc.version=(SELECT max(version) FROM scout_relevance_criteria) JOIN scout_position_states s ON s.position_id=d.position_id JOIN scout_position_observations o ON o.id=? WHERE d.position_id=? AND s.linked_gig_id IS NULL ORDER BY d.created_at DESC,d.id DESC LIMIT 1`).get(context.observationId,positionId) as {descriptionId:string;descriptionHash:string;criteriaId:string;criteriaVersion:number;promptVersion:string;title:string;location:string|null;officialUrl:string}|null;if(!row)return;const identity=createHash("sha256").update(JSON.stringify({positionId,title:row.title,location:row.location,officialUrl:row.officialUrl,descriptionHash:row.descriptionHash,criteriaVersion:row.criteriaVersion,promptVersion:row.promptVersion,model:this.screening.model,modelConfiguration:this.screening.modelConfiguration})).digest("hex");const evaluated=this.db.query(`SELECT 1 FROM scout_relevance_evaluations WHERE input_identity=?`).get(identity);if(!evaluated)this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage='score_candidate_match' AND status IN ('pending','failed')`).run(now,positionId);this.ensureStage(positionId,"screen_relevance",identity,now,{runId:context.runId,observationId:context.observationId,descriptionId:row.descriptionId,criteriaId:row.criteriaId});this.ensureCurrentCandidateMatch(positionId,identity,context.runId,context.observationId,now);}
  private ensureCurrentCandidateMatch(positionId:string,relevanceIdentity:string,runId:string,observationId:string,now:string){if(!this.screening)return;const row=this.db.query(`SELECT re.id relevanceEvaluationId,r.id rubricId,r.version rubricVersion,r.prompt_version promptVersion,sr.candidate_profile_hash profileHash FROM scout_relevance_evaluations re JOIN scout_candidate_match_rubrics r ON r.version=(SELECT max(version) FROM scout_candidate_match_rubrics) JOIN scout_runs sr ON sr.id=? WHERE re.position_id=? AND re.input_identity=? AND re.decision='passes_relevance'`).get(runId,positionId,relevanceIdentity) as {relevanceEvaluationId:string;rubricId:string;rubricVersion:number;promptVersion:string;profileHash:string|null}|null;if(!row?.profileHash)return;const identity=createHash("sha256").update(JSON.stringify({relevanceEvaluationId:row.relevanceEvaluationId,profileHash:row.profileHash,rubricVersion:row.rubricVersion,promptVersion:row.promptVersion,model:this.screening.model,modelConfiguration:this.screening.modelConfiguration})).digest("hex");this.ensureStage(positionId,"score_candidate_match",identity,now,{runId,observationId,relevanceEvaluationId:row.relevanceEvaluationId,rubricId:row.rubricId});}
  private descriptionIdentity(positionId:string,observationId?:string){const row=observationId?this.db.query(`SELECT o.canonical_url url,a.content_hash listingHash,o.title,o.location FROM scout_position_observations o LEFT JOIN scout_description_artifacts a ON a.id=o.description_artifact_id WHERE o.id=? AND o.position_id=?`).get(observationId,positionId) as {url:string;listingHash:string|null;title:string;location:string|null}|null:this.db.query(`SELECT o.canonical_url url,a.content_hash listingHash,o.title,o.location FROM scout_position_observations o LEFT JOIN scout_description_artifacts a ON a.id=o.description_artifact_id WHERE o.position_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`).get(positionId) as {url:string;listingHash:string|null;title:string;location:string|null}|null;return createHash("sha256").update(JSON.stringify({url:row?.url,title:row?.title,location:row?.location,listingHash:row?.listingHash,converterVersion:scoutDescriptionConverterVersion})).digest("hex");}
  descriptionInput(processingId:string):ScoutDescriptionInput{const row=this.db.query(`SELECT p.id positionId,o.title,c.name company,o.location,o.canonical_url officialUrl,a.file_path filePath,a.media_type mediaType FROM scout_position_processing x JOIN scout_positions p ON p.id=x.position_id JOIN scout_companies c ON c.id=p.company_id LEFT JOIN scout_position_observations o ON o.id=x.observation_id LEFT JOIN scout_description_artifacts a ON a.id=o.description_artifact_id WHERE x.id=? AND x.stage='acquire_description' AND x.status='pending'`).get(processingId) as {positionId:string;title:string;company:string;location:string|null;officialUrl:string;filePath:string|null;mediaType:string|null}|null;if(!row)throw new Error("Scout description work not found.");const listingContent=row.filePath&&this.descriptionsRoot?readFileSync(path.resolve(this.descriptionsRoot,row.filePath),"utf8"):null;return{positionId:row.positionId,title:row.title,company:row.company,location:row.location,officialUrl:row.officialUrl,listingContent,listingMediaType:row.mediaType};}
  async acquireDescription(input:ScoutDescriptionInput){if(input.listingContent!==null){const markdown=descriptionToMarkdown(input.listingContent,input.listingMediaType);if(!markdown)throw new Error("description_empty");return{markdown,sourceContentHash:createHash("sha256").update(input.listingContent).digest("hex"),sourceUrl:input.officialUrl,retrievedAt:new Date().toISOString(),converterVersion:scoutDescriptionConverterVersion};}return retrieveOfficialDescription(input.officialUrl,this.descriptionHttp);}
  private writeDescriptionArtifact(markdown:string,provenance:unknown,now:string){if(!this.descriptionsRoot)throw new Error("Scout description artifact storage is unavailable.");const hash=createHash("sha256").update(markdown).digest("hex"),artifactId=`sdesc_${hash}`,relative=path.join(hash.slice(0,2),`${hash}.md`),target=path.resolve(this.descriptionsRoot,relative),root=path.resolve(this.descriptionsRoot);if(!target.startsWith(`${root}${path.sep}`))throw new Error("Unsafe Scout description path.");mkdirSync(path.dirname(target),{recursive:true});const temporary=`${target}.${crypto.randomUUID()}.tmp`;writeFileSync(temporary,markdown,{encoding:"utf8",mode:0o600});renameSync(temporary,target);this.db.query(`INSERT OR IGNORE INTO scout_description_artifacts(id,file_path,content_hash,media_type,byte_count,provenance_json,created_at) VALUES(?,?,?,'text/markdown',?,?,?)`).run(artifactId,relative,hash,Buffer.byteLength(markdown),JSON.stringify(provenance),now);return{artifactId,hash};}
  completeDescription(processingId:string,value:{markdown:string;sourceContentHash:string;sourceUrl:string;retrievedAt:string;converterVersion:string},now:string){this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,observation_id observationId FROM scout_position_processing WHERE id=? AND stage='acquire_description' AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;observationId:string|null}|null;if(!work)return;const artifact=this.writeDescriptionArtifact(value.markdown,{sourceUrl:value.sourceUrl,retrievedAt:value.retrievedAt,sourceContentHash:value.sourceContentHash,converterVersion:value.converterVersion},now),descriptionId=id("spdesc",work.positionId,artifact.hash,value.converterVersion);this.db.query(`INSERT OR IGNORE INTO scout_position_descriptions(id,position_id,artifact_id,source_url,retrieved_at,source_content_hash,markdown_content_hash,converter_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(descriptionId,work.positionId,artifact.artifactId,value.sourceUrl,value.retrievedAt,value.sourceContentHash,artifact.hash,value.converterVersion,now);this.ensureCurrentRelevance(work.positionId,now,{runId:work.runId??undefined,observationId:work.observationId??undefined});this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,updated_at=?,completed_at=? WHERE id=?`).run(now,now,processingId);})();}
  relevanceInput(processingId:string):RelevanceRequest&{confidenceThreshold:number}{if(!this.screening)throw new Error("Scout screening configuration is unavailable.");const row=this.db.query(`SELECT p.id positionId,o.title,c.name company,o.location,o.canonical_url officialUrl,d.id descriptionId,d.artifact_id descriptionArtifactId,d.markdown_content_hash descriptionHash,a.file_path filePath,rc.criteria,rc.version criteriaVersion,rc.confidence_threshold confidenceThreshold,rc.prompt_version promptVersion FROM scout_position_processing x JOIN scout_positions p ON p.id=x.position_id JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_position_descriptions d ON d.id=x.description_id JOIN scout_description_artifacts a ON a.id=d.artifact_id JOIN scout_relevance_criteria rc ON rc.id=x.criteria_id WHERE x.id=? AND x.status='pending'`).get(processingId) as Record<string,unknown>|null;if(!row||!this.descriptionsRoot)throw new Error("Scout relevance inputs are unavailable.");return{positionId:String(row.positionId),title:String(row.title),company:String(row.company),location:nullableText(row.location),officialUrl:String(row.officialUrl),descriptionMarkdown:readFileSync(path.resolve(this.descriptionsRoot,String(row.filePath)),"utf8"),descriptionArtifactId:String(row.descriptionArtifactId),descriptionHash:String(row.descriptionHash),criteria:String(row.criteria),criteriaVersion:Number(row.criteriaVersion),confidenceThreshold:Number(row.confidenceThreshold)/1000,promptVersion:String(row.promptVersion)};}
  completeRelevance(processingId:string,result:ModelResult<RelevanceResult>,irrelevant:boolean,now:string){this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,observation_id observationId,input_identity inputIdentity,description_id descriptionId,criteria_id criteriaId FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;observationId:string|null;inputIdentity:string;descriptionId:string;criteriaId:string}|null;if(!work)return;const evaluationId=id("sre",work.inputIdentity);this.db.query(`INSERT OR IGNORE INTO scout_relevance_evaluations(id,position_id,description_id,criteria_id,input_identity,decision,reason,confidence,evidence_json,ambiguities_json,provider,model,model_configuration,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evaluationId,work.positionId,work.descriptionId,work.criteriaId,work.inputIdentity,result.value.decision,result.value.reason,Math.round(result.value.confidence*1000),JSON.stringify(result.value.evidence),JSON.stringify(result.value.ambiguities),result.metrics.provider,result.metrics.model,result.metrics.modelConfiguration,result.metrics.inputTokens,result.metrics.outputTokens,result.metrics.cacheReadTokens??null,result.metrics.cacheWriteTokens??null,result.metrics.latencyMs,now);if(irrelevant)this.db.query(`UPDATE scout_position_states SET state='irrelevant',revision=revision+1,updated_at=? WHERE position_id=? AND linked_gig_id IS NULL`).run(now,work.positionId);else if(work.runId&&work.observationId)this.ensureCurrentCandidateMatch(work.positionId,work.inputIdentity,work.runId,work.observationId,now);this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(now,now,processingId);})();}
  candidateMatchInput(processingId:string):CandidateMatchRequest{
    if(!this.screening||!this.descriptionsRoot)throw new Error("Scout candidate profile is unavailable.");
    const row=this.db.query(`SELECT p.id positionId,o.title,c.name company,o.location,o.canonical_url officialUrl,d.artifact_id descriptionArtifactId,d.markdown_content_hash descriptionHash,a.file_path filePath,re.id relevanceEvaluationId,r.rubric,r.version rubricVersion,r.prompt_version promptVersion,sr.screening_cache_key promptCacheKey,sr.candidate_profile_json profileJson,sr.candidate_profile_version profileVersion,sr.candidate_profile_artifact_id profileArtifactId,sr.candidate_profile_hash profileHash
      FROM scout_position_processing x
      JOIN scout_positions p ON p.id=x.position_id
      JOIN scout_companies c ON c.id=p.company_id
      JOIN scout_position_observations o ON o.id=x.observation_id
      JOIN scout_relevance_evaluations re ON re.id=x.relevance_evaluation_id
      JOIN scout_position_descriptions d ON d.id=re.description_id
      JOIN scout_description_artifacts a ON a.id=d.artifact_id
      JOIN scout_candidate_match_rubrics r ON r.id=x.rubric_id
      JOIN scout_runs sr ON sr.id=x.run_id
      WHERE x.id=? AND x.status='pending'`).get(processingId) as Record<string,unknown>|null;
    if(!row||typeof row.promptCacheKey!=="string"||typeof row.profileJson!=="string")throw new Error("Scout candidate-match inputs are unavailable.");
    return{positionId:String(row.positionId),title:String(row.title),company:String(row.company),location:nullableText(row.location),officialUrl:String(row.officialUrl),descriptionMarkdown:readFileSync(path.resolve(this.descriptionsRoot,String(row.filePath)),"utf8"),descriptionArtifactId:String(row.descriptionArtifactId),descriptionHash:String(row.descriptionHash),profile:JSON.parse(row.profileJson) as unknown,profileVersion:String(row.profileVersion),profileArtifactId:String(row.profileArtifactId),profileHash:String(row.profileHash),promptCacheKey:row.promptCacheKey,rubric:String(row.rubric),rubricVersion:Number(row.rubricVersion),promptVersion:String(row.promptVersion),relevanceEvaluationId:String(row.relevanceEvaluationId)};
  }
  completeCandidateMatch(processingId:string,result:ModelResult<CandidateMatchResult>,now:string){this.db.transaction(()=>{const input=this.candidateMatchInput(processingId),work=this.db.query(`SELECT input_identity inputIdentity,rubric_id rubricId FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {inputIdentity:string;rubricId:string}|null;if(!work)return;this.db.query(`INSERT OR IGNORE INTO scout_candidate_match_evaluations(id,position_id,relevance_evaluation_id,input_identity,profile_version,profile_artifact_id,profile_hash,rubric_id,score,score_explanation,provider,model,model_configuration,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id("scme",work.inputIdentity),input.positionId,input.relevanceEvaluationId,work.inputIdentity,input.profileVersion,input.profileArtifactId,input.profileHash,work.rubricId,result.value.score,result.value.scoreExplanation,result.metrics.provider,result.metrics.model,result.metrics.modelConfiguration,result.metrics.inputTokens,result.metrics.outputTokens,result.metrics.cacheReadTokens??null,result.metrics.cacheWriteTokens??null,result.metrics.latencyMs,now);this.db.query(`UPDATE scout_position_states SET state='needs_user_review',revision=revision+1,updated_at=? WHERE position_id=? AND linked_gig_id IS NULL`).run(now,input.positionId);this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(now,now,processingId);})();}

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
  relevanceCriteria(){const row=this.db.query(`SELECT version,criteria,confidence_threshold confidenceThreshold FROM scout_relevance_criteria ORDER BY version DESC LIMIT 1`).get() as {version:number;criteria:string;confidenceThreshold:number}|null;if(!row)throw new Error("Scout relevance criteria are unavailable.");return{...row,confidenceThreshold:Number(row.confidenceThreshold)/1000};}
  appendRelevanceCriteria(criteria:string,confidenceThreshold:number,now:string){return this.db.transaction(()=>{const version=Number((this.db.query(`SELECT coalesce(max(version),0)+1 version FROM scout_relevance_criteria`).get() as {version:number}).version);this.db.query(`INSERT INTO scout_relevance_criteria(id,version,criteria,confidence_threshold,prompt_version,created_at) VALUES(?,?,?,?,?,?)`).run(id("src",String(version),criteria),version,criteria,Math.round(confidenceThreshold*1000),"scout-relevance-v1",now);for(const row of this.db.query(`SELECT p.id FROM scout_positions p JOIN scout_position_states s ON s.position_id=p.id WHERE s.linked_gig_id IS NULL AND EXISTS(SELECT 1 FROM scout_position_descriptions d WHERE d.position_id=p.id)`).all() as Array<{id:string}>){if(this.screening){this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage='score_candidate_match' AND status IN ('pending','failed')`).run(now,row.id);this.ensureCurrentRelevance(row.id,now);this.db.query(`UPDATE scout_position_states SET state='processing',revision=revision+1,updated_at=? WHERE position_id=?`).run(now,row.id);}}return{version,criteria,confidenceThreshold};})();}
  workspace(input:{text?:string;company?:string;state?:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}):ScoutWorkspacePage{
    const where=["s.state<>'rejected'","s.linked_gig_id IS NULL"],params:string[]=[];
    if(input.state&&input.state!=="actionable"){where.push("s.state=?");params.push(input.state);}else where.push("s.state IN ('processing','needs_user_review','deferred')");
    const escape=(value:string)=>`%${value.toLowerCase().replace(/[%_\\]/g,"\\$&")}%`;
    if(input.company){where.push("lower(c.name) LIKE ? ESCAPE '\\'");params.push(escape(input.company));}
    if(input.text){where.push("(lower(p.title) LIKE ? ESCAPE '\\' OR lower(coalesce(p.location,'')) LIKE ? ESCAPE '\\' OR lower(c.name) LIKE ? ESCAPE '\\')");params.push(escape(input.text),escape(input.text),escape(input.text));}
    const base=` FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_states s ON s.position_id=p.id WHERE ${where.join(" AND ")}`;
    const total=Number((this.db.query(`SELECT count(*) count${base}`).get(...params) as {count:number}).count);
    const sortColumns:Record<string,string>={last_seen:"p.last_seen_at",first_seen:"p.first_seen_at",company:"lower(c.name)",title:"lower(p.title)",state:"s.state",score:"(SELECT m.score FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1)"};const order=`${sortColumns[input.sort]??sortColumns.last_seen} ${input.direction.toUpperCase()},p.id ${input.direction.toUpperCase()}`;
    const rows=this.db.query(`SELECT p.id,p.title,c.name company,p.location,p.canonical_url canonicalUrl,s.state,p.first_seen_at firstSeenAt,p.last_seen_at lastSeenAt,(SELECT count(*) FROM scout_position_observations o WHERE o.position_id=p.id) observationCount,EXISTS(SELECT 1 FROM scout_position_observations o WHERE o.position_id=p.id AND o.description_artifact_id IS NOT NULL) descriptionAvailable,(SELECT stage FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingStage,(SELECT status FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingStatus,(SELECT failure_code FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingFailureCode,(SELECT failure_message FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingFailureMessage,(SELECT m.score FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) score,(SELECT m.score_explanation FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) scoreExplanation,(SELECT rc.version FROM scout_relevance_evaluations re JOIN scout_relevance_criteria rc ON rc.id=re.criteria_id WHERE re.position_id=p.id ORDER BY re.created_at DESC,re.id DESC LIMIT 1) criteriaVersion,(SELECT r.version FROM scout_candidate_match_evaluations m JOIN scout_candidate_match_rubrics r ON r.id=m.rubric_id WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) rubricVersion,(SELECT m.profile_version FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) profileVersion,(SELECT m.model FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) model,(SELECT m.provider FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) provider${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,input.limit,input.offset) as ScoutWorkspacePage["items"];
    const countWhere=["s.state<>'rejected'","s.linked_gig_id IS NULL"],countParams:string[]=[];if(input.company){countWhere.push("lower(c.name) LIKE ? ESCAPE '\\'");countParams.push(escape(input.company));}if(input.text){countWhere.push("(lower(p.title) LIKE ? ESCAPE '\\' OR lower(coalesce(p.location,'')) LIKE ? ESCAPE '\\' OR lower(c.name) LIKE ? ESCAPE '\\')");countParams.push(escape(input.text),escape(input.text),escape(input.text));}const counts={actionable:0,processing:0,needs_user_review:0,irrelevant:0,deferred:0};for(const row of this.db.query(`SELECT s.state,count(*) count FROM scout_position_states s JOIN scout_positions p ON p.id=s.position_id JOIN scout_companies c ON c.id=p.company_id WHERE ${countWhere.join(" AND ")} GROUP BY s.state`).all(...countParams) as Array<{state:keyof typeof counts;count:number}>){if(row.state in counts)counts[row.state]=Number(row.count);if(["processing","needs_user_review","deferred"].includes(row.state))counts.actionable+=Number(row.count);}
    return{items:rows.map(row=>({...row,descriptionAvailable:Boolean(this.db.query(`SELECT 1 FROM scout_position_descriptions WHERE position_id=? LIMIT 1`).get(row.id)),observationCount:Number(row.observationCount),score:row.score===null?null:Number(row.score)})),offset:input.offset,limit:input.limit,total,counts};
  }
  positionDetail(positionId:string):ScoutPositionDetail|null{const row=this.db.query(`SELECT p.id,p.title,c.name company,p.location,p.canonical_url canonicalUrl,p.external_id externalId,p.source_key sourceKey,s.state,p.first_seen_at firstSeenAt,p.last_seen_at lastSeenAt,(SELECT count(*) FROM scout_position_observations o WHERE o.position_id=p.id) observationCount,EXISTS(SELECT 1 FROM scout_position_observations o WHERE o.position_id=p.id AND o.description_artifact_id IS NOT NULL) descriptionAvailable,(SELECT stage FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingStage,(SELECT status FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingStatus,(SELECT failure_code FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingFailureCode,(SELECT failure_message FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingFailureMessage,(SELECT m.score FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) score,(SELECT m.score_explanation FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) scoreExplanation,(SELECT rc.version FROM scout_relevance_evaluations re JOIN scout_relevance_criteria rc ON rc.id=re.criteria_id WHERE re.position_id=p.id ORDER BY re.created_at DESC,re.id DESC LIMIT 1) criteriaVersion,(SELECT r.version FROM scout_candidate_match_evaluations m JOIN scout_candidate_match_rubrics r ON r.id=m.rubric_id WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) rubricVersion,(SELECT m.profile_version FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) profileVersion,(SELECT m.model FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) model,(SELECT m.provider FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) provider FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_states s ON s.position_id=p.id WHERE p.id=? AND s.state NOT IN ('rejected','irrelevant') AND s.linked_gig_id IS NULL`).get(positionId) as (Omit<ScoutPositionDetail,"observations"|"descriptionAvailable"|"observationCount">&{descriptionAvailable:number;observationCount:number})|null;if(!row)return null;const observations=(this.db.query(`SELECT o.id,rc.run_id runId,r.created_at runCreatedAt,rc.status companyStatus,cs.source_key sourceKey,rs.status sourceStatus,o.title,o.canonical_url canonicalUrl,o.location,o.observed_at observedAt,o.description_artifact_id IS NOT NULL descriptionAvailable,o.provenance_json provenance FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_company_configuration_sources cs ON cs.id=rs.configuration_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id JOIN scout_runs r ON r.id=rc.run_id WHERE o.position_id=? ORDER BY o.observed_at DESC,o.id DESC`).all(positionId) as Array<Omit<ScoutPositionDetail["observations"][number],"descriptionAvailable"|"provenance">&{descriptionAvailable:number;provenance:string}>).map(value=>({...value,descriptionAvailable:Boolean(value.descriptionAvailable),provenance:JSON.parse(value.provenance) as unknown}));return{...row,descriptionAvailable:Boolean(this.db.query(`SELECT 1 FROM scout_position_descriptions WHERE position_id=? LIMIT 1`).get(positionId)),observationCount:Number(row.observationCount),score:row.score===null?null:Number(row.score),observations} as ScoutPositionDetail;}
}
