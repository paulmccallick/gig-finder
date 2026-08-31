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
  PreparedScoutCompanyResult,
  ScoutPositionPage,
  ScoutRunDetail,
  ScoutRunStore,
  ScoutRunSummary,
} from "../core/scout/engine/runs";
import type { ScoutBackfillStatus,ScoutPositionBackfillCommand,ScoutPositionBackfillPreview,ScoutPositionBackfillStatus,ScoutPositionDetail,ScoutPositionProcessingJob,ScoutPositionProcessingStage,ScoutPositionState,ScoutPositionStore,ScoutPromotionWork,ScoutPromotedDescriptionOutcome,ScoutPromotedDescriptionWork,ScoutUserDecisionCommand,ScoutWorkspacePage } from "../core/scout/engine/positions";
import type { CandidateMatchRequest, ModelResult, RelevanceRequest, RelevanceResult, CandidateMatchResult, ScoutDescriptionInput, ScoutDescriptionResult, ScoutPositionProcessingRepository, ScoutScreeningModelIdentity } from "../core/scout/engine/screening";
import { BoundedFetchHttpPort } from "../core/scout/sourcing/ports";
import { scoutDescriptionConverterVersion } from "../core/scout/sourcing/descriptions";
import { acquirePlannedDescription, resolveDetailDescriptionPlan, type DetailDescriptionPlan } from "../core/scout/sourcing/detail-descriptions";
import type { TemplateResolver } from "../core/scout/sourcing/adapters/templates/definitions";
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
interface RunScreeningSnapshot extends ScoutScreeningInputs {promptCacheKey:string;immutable:boolean}
export class SqliteScoutRunStore implements ScoutRunStore,ScoutPositionStore,ScoutPositionProcessingRepository {
  constructor(
    private readonly db: Database,
    private readonly descriptionsRoot?: string,
    private readonly screening?:ScoutScreeningInputs,
    private readonly descriptionHttp=new BoundedFetchHttpPort(),
    private readonly templates?:TemplateResolver,
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
  prepareCompanyResult(
    job: ScoutCompanyJob,
    result: CompanyScanResult,
    now: string,
  ): PreparedScoutCompanyResult {
    return this.db.transaction(() => {
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
              `INSERT OR REPLACE INTO scout_source_attempts(id,run_source_id,attempt_number,source_method,stage,request_count,response_count,source_reported_total,records_received,records_parsed,records_evaluable,records_evaluated,candidate_count,accepted_count,rejected_count,pages_requested,pages_validated,unique_identities,validation_status,filter_decisions_json,started_at,completed_at,failure_code,failure_message) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
              JSON.stringify(attempt.filterDecisions ?? []),
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
      const companyStatus:PreparedScoutCompanyResult["status"] =
        statuses.length > 0 &&
        statuses.every((status) => status.startsWith("succeeded_"))
          ? "succeeded"
          : statuses.some(
                (status) =>
                  status.startsWith("succeeded_") || status === "partial",
              )
            ? "partial"
            : "failed";
      const company = this.db
        .query(`SELECT name FROM scout_companies WHERE id=?`)
        .get(job.companyId) as { name: string } | null;
      if (!company) throw new Error("Scout company not found.");
      const observedPositions = [
        ...new Map(
          result.positions.map((position) => [
            `${position.canonicalUrl}\0${position.externalId ?? ""}`,
            {
              canonicalUrl: position.canonicalUrl,
              externalId: position.externalId,
            },
          ]),
        ).values(),
      ];
      return {
        companyName: company.name,
        status: companyStatus,
        observedPositions,
      };
    })();
  }
  completeCompanyResult(
    job: ScoutCompanyJob,
    result: PreparedScoutCompanyResult,
    now: string,
  ): void {
    this.db.transaction(() => {
      const changed = this.db
        .query(
          `UPDATE scout_run_companies SET status=?,completed_at=?,failure_code=?,failure_message=? WHERE id=? AND status IN ('queued','dispatched','running')`,
        )
        .run(
          result.status,
          now,
          result.status === "failed" ? "all_sources_failed" : null,
          result.status === "failed"
            ? "No configured source completed successfully."
            : null,
          job.runCompanyId,
        ).changes;
      if (changed) this.finalize(job.runId, now);
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
    const sourceBinding=this.db.query(`SELECT s.settings_json settings FROM scout_run_sources rs JOIN scout_company_configuration_sources s ON s.id=rs.configuration_source_id WHERE rs.id=?`).get(runSourceId) as {settings:string};
    const sourceSettings=JSON.parse(sourceBinding.settings) as SourceConfiguration;
    const descriptionArtifactId = this.materializeDescription(position, now,{
      ...position.provenance,
      configurationVersionId:job.configurationVersionId,
      template:"template" in sourceSettings?sourceSettings.template:null,
      extractionStrategy:"search-result-v1",
      converterVersion:scoutDescriptionConverterVersion,
    });
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
        JSON.stringify({
          ...position.provenance,
          displayLocation: position.location,
          locations: position.locations ?? [],
          workArrangement: position.workArrangement ?? null,
        }),
        now,
      );
    const observationId=id("sobs", runSourceId, positionId);
    if(descriptionArtifactId&&position.description){
      const hash=createHash("sha256").update(position.description).digest("hex");
      const sourceHash=createHash("sha256").update(position.descriptionSourceContent??position.description).digest("hex");
      const descriptionId=id("spdesc",positionId,hash,scoutDescriptionConverterVersion);
      this.db.query(`INSERT OR IGNORE INTO scout_position_descriptions(id,position_id,artifact_id,source_url,retrieved_at,source_content_hash,markdown_content_hash,converter_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(descriptionId,positionId,descriptionArtifactId,position.provenance.sourceUrl,now,sourceHash,hash,scoutDescriptionConverterVersion,now);
    }
    this.ensurePositionProcessing(positionId,now,{runId:job.runId,observationId});
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
  private ensurePositionProcessing(positionId:string,now:string,bindings:{runId?:string;observationId?:string;configurationSourceId?:string}={}){
    const inputIdentity=this.processingInputIdentity(positionId,bindings.observationId),processingId=id("spp",positionId,"reconcile_gig",inputIdentity);
    this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage='reconcile_gig' AND status IN ('pending','failed') AND input_identity<>?`).run(now,positionId,inputIdentity);
    const inserted=this.db.query(`INSERT OR IGNORE INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,stage,input_identity,status,created_at,updated_at) VALUES(?,?,?,?,?,'reconcile_gig',?,'pending',?,?)`).run(processingId,positionId,bindings.runId??null,bindings.observationId??null,bindings.configurationSourceId??null,inputIdentity,now,now).changes>0;
    if(inserted)this.db.query(`INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,created_at) VALUES(?,?,?,?)`).run(id("sppo",processingId),processingId,`position:${processingId}`,now);
    const revived=!inserted&&this.db.query(`UPDATE scout_position_processing SET run_id=?,observation_id=?,configuration_source_id=?,status='pending',attempt_count=0,failure_code=NULL,failure_message=NULL,updated_at=?,completed_at=NULL WHERE id=? AND status IN ('failed','superseded')`).run(bindings.runId??null,bindings.observationId??null,bindings.configurationSourceId??null,now,processingId).changes>0;
    if(revived)this.db.query(`UPDATE scout_position_processing_outbox SET dispatch_status='pending',dispatched_at=NULL WHERE processing_id=?`).run(processingId);
    if(!inserted&&!revived){const current=this.db.query(`SELECT s.linked_gig_id linkedGigId,x.status FROM scout_position_states s JOIN scout_position_processing x ON x.position_id=s.position_id AND x.stage='reconcile_gig' AND x.input_identity=? WHERE s.position_id=?`).get(inputIdentity,positionId) as {linkedGigId:string|null;status:string}|null;if(current?.status==="completed"&&!current.linkedGigId)this.ensureStage(positionId,"acquire_description",this.descriptionIdentity(positionId,bindings.observationId,bindings.configurationSourceId),now,bindings);}
    return inserted||revived;
  }
  pendingPositionJobs(limit:number){return this.db.query(`SELECT p.id,p.id processingId,p.position_id positionId,p.stage,p.input_identity inputIdentity,p.attempt_count attemptCount FROM scout_position_processing p JOIN scout_position_processing_outbox o ON o.processing_id=p.id WHERE p.status='pending' ORDER BY CASE p.stage WHEN 'reconcile_gig' THEN 0 WHEN 'acquire_description' THEN 1 WHEN 'screen_relevance' THEN 2 ELSE 3 END,o.created_at,o.id LIMIT ?`).all(limit) as ScoutPositionProcessingJob[];}
  markPositionJobsDispatched(ids:string[],now:string){const q=this.db.query(`UPDATE scout_position_processing_outbox SET dispatch_status='dispatched',dispatched_at=? WHERE processing_id=?`);this.db.transaction(()=>ids.forEach(value=>q.run(now,value)))();}
  reconcileGig(processing:string|ScoutPositionProcessingJob,now:string){const processingId=typeof processing==="string"?processing:(processing.processingId??processing.id);this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,observation_id observationId,configuration_source_id configurationSourceId FROM scout_position_processing WHERE id=? AND stage='reconcile_gig' AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;observationId:string|null;configurationSourceId:string|null}|null;if(!work)return;const position=this.db.query(`SELECT o.canonical_url canonicalUrl,p.external_id externalId,c.name company FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_observations o ON o.id=? AND o.position_id=p.id WHERE p.id=?`).get(work.observationId,work.positionId) as {canonicalUrl:string;externalId:string|null;company:string}|null;if(!position)throw new Error("Scout position not found.");const matches=this.db.query(`SELECT id FROM gigs WHERE is_deleted=0 AND ((source_url IS NOT NULL AND source_url=?) OR (external_job_id IS NOT NULL AND external_job_id=? AND lower(trim(company))=lower(trim(?)))) ORDER BY id`).all(position.canonicalUrl,position.externalId,position.company) as Array<{id:string}>;const unique=[...new Set(matches.map(match=>match.id))],matchId=unique[0],exactMatch=unique.length===1&&Boolean(matchId),positionBackfill=this.isPositionBackfillRun(work.runId),preserveUserWorkflow=positionBackfill&&this.hasUserOwnedWorkflow(work.positionId);if(exactMatch&&matchId){const current=this.db.query(`SELECT * FROM scout_position_states WHERE position_id=?`).get(work.positionId) as Record<string,unknown>,preserveLink=positionBackfill&&typeof current.linked_gig_id==="string";if(!preserveLink&&!preserveUserWorkflow&&(current.state!=="promoted"||current.linked_gig_id!==matchId)){const changeId=`change_${crypto.randomUUID()}`;this.db.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,'Gig Scout','automation','Promoted exact-matched Scout position','committed')`).run(changeId,now);this.db.query(`INSERT INTO scout_position_state_history(change_id,operation,recorded_at,recorded_by,position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at) SELECT ?,'update',?,'Gig Scout',position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at FROM scout_position_states WHERE position_id=?`).run(changeId,now,work.positionId);this.db.query(`UPDATE scout_position_states SET state='promoted',linked_gig_id=?,deferred_until=NULL,revision=revision+1,updated_at=? WHERE position_id=?`).run(matchId,now,work.positionId);}if(work.runId&&!preserveLink&&!preserveUserWorkflow)this.db.query(`UPDATE scout_position_backfill_items SET linked_gig_id=? WHERE run_id=? AND position_id=?`).run(matchId,work.runId,work.positionId);}if(!exactMatch||positionBackfill){const descriptionIdentity=this.positionBackfillIdentity(work.runId,this.descriptionIdentity(work.positionId,work.observationId??undefined,work.configurationSourceId??undefined));this.ensureStage(work.positionId,"acquire_description",descriptionIdentity,now,{runId:work.runId??undefined,observationId:work.observationId??undefined,configurationSourceId:work.configurationSourceId??undefined});}this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,failure_code=NULL,failure_message=NULL,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(now,now,processingId);})();}
  failPositionProcessing(processing:string|ScoutPositionProcessingJob,code:string,message:string,now:string){const processingId=typeof processing==="string"?processing:(processing.processingId??processing.id);this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,stage FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;stage:ScoutPositionProcessingStage}|null;if(!work)return;this.db.query(`UPDATE scout_position_processing SET status='failed',attempt_count=3,failure_code=?,failure_message=?,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(code.slice(0,100),message.slice(0,500),now,now,processingId);if(work.runId&&this.isPositionBackfillRun(work.runId)){const boundedMessageCode=/^[a-z][a-z0-9_]{0,99}$/.test(message)?message:null,failureCode=(boundedMessageCode??code).slice(0,100),unavailable=work.stage==="acquire_description"&&/^description_http_(?:404|410)$/.test(failureCode);this.completePositionBackfillItem(work.runId,work.positionId,unavailable?"unavailable":"failed",now,failureCode);}})();}
  backfillPositions(sourceRunId:string,limit:number,now:string){return this.db.transaction(()=>{
    const source=this.db.query(`SELECT batch_size batchSize,concurrency FROM scout_runs WHERE id=? AND run_type='full'`).get(sourceRunId) as {batchSize:number;concurrency:number}|null;
    if(!source)throw new Error("Scout backfill source run not found.");
    let execution=this.db.query(`SELECT id FROM scout_runs WHERE run_type='legacy_backfill' AND source_run_id=?`).get(sourceRunId) as {id:string}|null;
    if(!execution){
      const backfillRunId=`srun_${crypto.randomUUID()}`;
      this.db.query(`INSERT INTO scout_runs(id,status,run_type,source_run_id,batch_size,concurrency,search_profile_json,screening_cache_key,created_at,started_at,company_count) VALUES(?,'running','legacy_backfill',?,?,?,?,?,?,?,0)`).run(backfillRunId,sourceRunId,source.batchSize,source.concurrency,'{"terms":[],"locations":[]}',crypto.randomUUID(),now,now);
      execution={id:backfillRunId};
    }
    const backfillRunId=execution.id,checkpointName=`reconcile_gig:${sourceRunId}`,gigIdentitySignature=createHash("sha256").update(JSON.stringify(this.db.query(`SELECT company,external_job_id,source_url,is_deleted FROM gigs ORDER BY id`).all())).digest("hex");
    const checkpoint=this.db.query(`SELECT last_position_id,gig_identity_signature,completed_at FROM scout_position_backfill WHERE name=? AND source_run_id=?`).get(checkpointName,sourceRunId) as {last_position_id:string|null;gig_identity_signature:string|null;completed_at:string|null}|null;
    const identityChanged=Boolean(checkpoint?.gig_identity_signature&&checkpoint.gig_identity_signature!==gigIdentitySignature),startAfter=identityChanged?"":(checkpoint?.last_position_id??"");
    const eligible=` FROM scout_positions p JOIN scout_position_observations selected_observation ON selected_observation.id=(SELECT o.id FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE o.position_id=p.id AND rc.run_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 1) WHERE p.id>?`;
    const rows=this.db.query(`SELECT p.id,selected_observation.id observationId,(SELECT current_source.id FROM scout_companies current_company JOIN scout_company_configuration_sources current_source ON current_source.company_configuration_id=current_company.current_configuration_id AND current_source.source_key=p.source_key AND current_source.active=1 WHERE current_company.id=p.company_id) configurationSourceId${eligible} ORDER BY p.id LIMIT ?`).all(sourceRunId,checkpoint?.completed_at&&!identityChanged?"":startAfter,checkpoint?.completed_at&&!identityChanged?Number.MAX_SAFE_INTEGER:limit) as Array<{id:string;observationId:string;configurationSourceId:string|null}>;
    for(const row of rows){
      this.initializePosition(row.id,now);
      const bindings={runId:backfillRunId,observationId:row.observationId,configurationSourceId:row.configurationSourceId??undefined};
      this.ensurePositionProcessing(row.id,now,bindings);
      this.recoverExistingRelevance(row.id,sourceRunId,backfillRunId,row.observationId,now);
    }
    const complete=Boolean(checkpoint?.completed_at&&!identityChanged)||rows.length<limit,last=rows.at(-1)?.id??(identityChanged?null:checkpoint?.last_position_id??null);
    this.db.query(`INSERT INTO scout_position_backfill(name,source_run_id,last_position_id,gig_identity_signature,completed_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET source_run_id=excluded.source_run_id,last_position_id=excluded.last_position_id,gig_identity_signature=excluded.gig_identity_signature,completed_at=excluded.completed_at,updated_at=excluded.updated_at`).run(checkpointName,sourceRunId,last,gigIdentitySignature,complete?now:null,now);
    return this.legacyBackfillStatus(backfillRunId,sourceRunId,complete,now);
  })();}
  private legacyBackfillStatus(backfillRunId:string,sourceRunId:string,complete:boolean,now:string):ScoutBackfillStatus{
    const selected=Number((this.db.query(`SELECT count(DISTINCT o.position_id) count FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE rc.run_id=?`).get(sourceRunId) as {count:number}).count);
    const stages=["reconcile_gig","acquire_description","screen_relevance","score_candidate_match"] as const;
    const empty=()=>({pending:0,completed:0,failed:0,superseded:0});
    const stageCounts=Object.fromEntries(stages.map(stage=>[stage,empty()])) as Record<ScoutPositionProcessingStage,ReturnType<typeof empty>>;
    const rows=this.db.query(`SELECT x.stage,x.status,count(*) count FROM scout_position_processing x WHERE x.run_id IN (?,?) AND x.position_id IN (SELECT o.position_id FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE rc.run_id=?) GROUP BY x.stage,x.status`).all(backfillRunId,sourceRunId,sourceRunId) as Array<{stage:ScoutPositionProcessingStage;status:keyof ReturnType<typeof empty>;count:number}>;
    for(const row of rows)stageCounts[row.stage][row.status]=Number(row.count);
    const downstream=empty();for(const counts of Object.values(stageCounts))for(const status of Object.keys(downstream) as Array<keyof typeof downstream>)downstream[status]+=counts[status];
    const recoveryRows=this.db.query(`SELECT c.name company,s.settings_json settings,x.status,x.failure_code failureCode FROM scout_position_processing x JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id JOIN scout_companies c ON c.id=rc.company_id JOIN scout_company_configuration_sources s ON s.id=coalesce(x.configuration_source_id,rs.configuration_source_id) WHERE x.stage='acquire_description' AND x.run_id IN (?,?) AND x.position_id IN (SELECT source_o.position_id FROM scout_position_observations source_o JOIN scout_run_sources source_rs ON source_rs.id=source_o.run_source_id JOIN scout_run_companies source_rc ON source_rc.id=source_rs.run_company_id WHERE source_rc.run_id=?)`).all(backfillRunId,sourceRunId,sourceRunId) as Array<{company:string;settings:string;status:string;failureCode:string|null}>;
    const recovery=new Map<string,{company:string;template:string;extractionStrategy:string;failureCode:string|null;recovered:number;unresolved:number}>();
    for(const row of recoveryRows){const settings=JSON.parse(row.settings) as SourceConfiguration;const detail="template" in settings?(this.templates?.resolve(settings.template).detailDescription):settings.detailDescription;const template="template" in settings?`${settings.template.id}@${settings.template.version}`:"custom";const extractionStrategy=detail?`${detail.response}-${detail.response==="html"?detail.extractor?.type??"unknown":"field"}-v1`:"unconfigured";const failureCode=row.failureCode;const key=JSON.stringify([row.company,template,extractionStrategy,failureCode]);const value=recovery.get(key)??{company:row.company,template,extractionStrategy,failureCode,recovered:0,unresolved:0};if(row.status==="completed")value.recovered++;else if(row.status==="failed"||row.status==="pending")value.unresolved++;recovery.set(key,value);}
    if(complete&&downstream.pending===0)this.db.query(`UPDATE scout_runs SET status=?,completed_at=coalesce(completed_at,?) WHERE id=?`).run(downstream.failed?"partial":"completed",now,backfillRunId);
    return{backfillRunId,sourceRunId,selection:{selected,complete},downstream:{...downstream,stages:stageCounts},descriptionRecovery:[...recovery.values()].sort((a,b)=>a.company.localeCompare(b.company)||a.template.localeCompare(b.template)||a.extractionStrategy.localeCompare(b.extractionStrategy)||(a.failureCode??"").localeCompare(b.failureCode??""))};
  }
  private normalizePositionBackfill(command:ScoutPositionBackfillCommand){
    if(!Array.isArray(command.positionIds))throw new Error("Scout position backfill requires between 1 and 1,000 exact position IDs.");
    if(command.positionIds.some(positionId=>typeof positionId!=="string"||!/^spos_[0-9a-f]{32}$/.test(positionId)))throw new Error("Scout position backfill contains a malformed position ID.");
    const positionIds=[...new Set(command.positionIds)].sort();
    if(positionIds.length===0||positionIds.length>1000)throw new Error("Scout position backfill requires between 1 and 1,000 exact position IDs.");
    const reason=typeof command.reason==="string"?command.reason.trim():"";
    if(reason.length<1||reason.length>500)throw new Error("Scout position backfill reason must contain between 1 and 500 characters.");
    return{positionIds,reason};
  }
  private resolvePositionBackfill(command:ScoutPositionBackfillCommand){
    const normalized=this.normalizePositionBackfill(command);
    const accepted:Array<ScoutPositionBackfillPreview["accepted"][number]&{observationId:string;configurationSourceId:string;template:string;initialDecisionOrigin:"agent"|"user"|"system"|null}>=[];
    const rejected:ScoutPositionBackfillPreview["rejected"]=[];
    for(const positionId of normalized.positionIds){
      const position=this.db.query(`SELECT p.id positionId,p.external_id externalId,p.canonical_url canonicalUrl,c.name company,p.title,coalesce(s.state,'processing') state,s.linked_gig_id linkedGigId,(SELECT decision.origin FROM scout_position_decisions decision WHERE decision.id=s.current_decision_id) initialDecisionOrigin FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id LEFT JOIN scout_position_states s ON s.position_id=p.id WHERE p.id=?`).get(positionId) as {positionId:string;externalId:string|null;canonicalUrl:string;company:string;title:string;state:ScoutPositionState;linkedGigId:string|null;initialDecisionOrigin:"agent"|"user"|"system"|null}|null;
      if(!position){rejected.push({positionId,code:"not_found"});continue;}
      const observation=this.db.query(`SELECT id,title FROM scout_position_observations WHERE position_id=? ORDER BY observed_at DESC,id DESC LIMIT 1`).get(positionId) as {id:string;title:string}|null;
      if(!observation){rejected.push({positionId,code:"no_observation"});continue;}
      const source=this.db.query(`SELECT cs.id,cs.settings_json settings FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id JOIN scout_company_configuration_sources cs ON cs.company_configuration_id=c.current_configuration_id AND cs.source_key=p.source_key AND cs.active=1 WHERE p.id=?`).get(positionId) as {id:string;settings:string}|null;
      if(!source){rejected.push({positionId,code:"no_active_configuration"});continue;}
      const configuredSource=JSON.parse(source.settings) as SourceConfiguration;
      const detailPlan=this.detailPlan(configuredSource,{id:position.externalId,title:observation.title,url:position.canonicalUrl});
      if(!detailPlan){
        rejected.push({positionId,code:"description_acquisition_not_configured"});
        continue;
      }
      if(!position.externalId?.trim()&&(Boolean(detailPlan.identity?.idPath)||(detailPlan.extractor?.type==="dom"&&Boolean(detailPlan.extractor.idSelector)))){
        rejected.push({positionId,code:"description_identity_input_missing"});
        continue;
      }
      const {externalId:_externalId,canonicalUrl:_canonicalUrl,...preview}=position;
      const template="template" in configuredSource?`${configuredSource.template.id}@${configuredSource.template.version}`:"custom";
      accepted.push({...preview,title:observation.title,observationId:observation.id,configurationSourceId:source.id,template});
    }
    return{...normalized,accepted,rejected};
  }
  previewBackfill(command:ScoutPositionBackfillCommand):ScoutPositionBackfillPreview{
    const resolved=this.resolvePositionBackfill(command);
    return{requested:resolved.positionIds.length,accepted:resolved.accepted.map(({observationId:_observationId,configurationSourceId:_configurationSourceId,template:_template,initialDecisionOrigin:_initialDecisionOrigin,...position})=>position),rejected:resolved.rejected};
  }
  startBackfill(command:ScoutPositionBackfillCommand,now:string):ScoutPositionBackfillStatus{return this.db.transaction(()=>{
    if(!this.screening)throw new Error("Scout screening configuration is unavailable.");
    const resolved=this.resolvePositionBackfill(command);
    if(resolved.rejected.length)throw new Error(`Scout position backfill rejected ${resolved.rejected.map(item=>`${item.positionId} (${item.code})`).join(", ")}.`);
    const requestFingerprint=createHash("sha256").update(JSON.stringify({positionIds:resolved.positionIds,reason:resolved.reason,observationIds:resolved.accepted.map(item=>item.observationId),configurationSourceIds:resolved.accepted.map(item=>item.configurationSourceId)})).digest("hex");
    const runId=`srun_${crypto.randomUUID()}`;
    const inserted=this.db.query(`INSERT OR IGNORE INTO scout_runs(id,status,run_type,batch_size,concurrency,search_profile_json,screening_cache_key,candidate_profile_json,candidate_profile_version,candidate_profile_artifact_id,candidate_profile_hash,screening_model,screening_provider,screening_model_configuration,operator_reason,request_fingerprint,created_at,started_at,company_count) VALUES(?,'running','position_backfill',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(runId,resolved.accepted.length,Math.min(5,resolved.accepted.length),'{"terms":[],"locations":[]}',crypto.randomUUID(),JSON.stringify(this.screening.profile),this.screening.profileVersion,this.screening.profileArtifactId,this.screening.profileHash,this.screening.model,this.screening.provider,this.screening.modelConfiguration,resolved.reason,requestFingerprint,now,now).changes>0;
    if(!inserted){
      const existing=this.db.query(`SELECT id FROM scout_runs WHERE run_type='position_backfill' AND request_fingerprint=?`).get(requestFingerprint) as {id:string}|null;
      if(!existing)throw new Error("Scout position backfill idempotency conflict could not be resolved.");
      const items=this.db.query(`SELECT position_id positionId,observation_id observationId,configuration_source_id configurationSourceId FROM scout_position_backfill_items WHERE run_id=? ORDER BY position_id`).all(existing.id) as Array<{positionId:string;observationId:string;configurationSourceId:string}>;
      const expected=resolved.accepted.map(item=>({positionId:item.positionId,observationId:item.observationId,configurationSourceId:item.configurationSourceId}));
      if(JSON.stringify(items)!==JSON.stringify(expected))throw new Error("Existing Scout position backfill does not match the requested immutable item set.");
      return this.backfillStatus(existing.id)!;
    }
    for(const item of resolved.accepted){
      this.db.query(`INSERT INTO scout_position_backfill_items(run_id,position_id,observation_id,configuration_source_id,linked_gig_id,company_name,template_name,initial_state,initial_decision_origin,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(runId,item.positionId,item.observationId,item.configurationSourceId,item.linkedGigId,item.company,item.template,item.state,item.initialDecisionOrigin,now);
      const supersededRuns=(this.db.query(`SELECT run_id runId FROM scout_position_backfill_items WHERE position_id=? AND run_id<>? AND final_outcome IS NULL ORDER BY run_id`).all(item.positionId,runId) as Array<{runId:string}>).map(row=>row.runId);
      if(supersededRuns.length){
        this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND run_id<>? AND status IN ('pending','failed') AND run_id IN (SELECT id FROM scout_runs WHERE run_type='position_backfill')`).run(now,item.positionId,runId);
        for(const supersededRunId of supersededRuns)this.completePositionBackfillItem(supersededRunId,item.positionId,"superseded",now);
      }
      this.initializePosition(item.positionId,now);
      const inputIdentity=createHash("sha256").update(JSON.stringify({runId,identity:this.processingInputIdentity(item.positionId,item.observationId)})).digest("hex");
      this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage='reconcile_gig' AND status IN ('pending','failed')`).run(now,item.positionId);
      const processingId=id("spp",item.positionId,"reconcile_gig",inputIdentity);
      this.db.query(`INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,stage,input_identity,status,created_at,updated_at) VALUES(?,?,?,?,?,'reconcile_gig',?,'pending',?,?)`).run(processingId,item.positionId,runId,item.observationId,item.configurationSourceId,inputIdentity,now,now);
      this.db.query(`INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,created_at) VALUES(?,?,?,?)`).run(id("sppo",processingId),processingId,`position:${processingId}`,now);
    }
    return this.backfillStatus(runId)!;
  })();}
  private finalizePositionBackfillRun(runId:string,now:string){
    const counts=this.db.query(`SELECT count(*) total,sum(final_outcome IS NULL) pending,sum(final_outcome IN ('failed','unavailable')) failed,sum(final_outcome='superseded') superseded FROM scout_position_backfill_items WHERE run_id=?`).get(runId) as {total:number;pending:number;failed:number;superseded:number};
    if(!Number(counts.total))return;
    const pending=Number(counts.pending),failed=Number(counts.failed),superseded=Number(counts.superseded),total=Number(counts.total),status=pending?"running":failed===total?"failed":failed||superseded?"partial":"completed";
    this.db.query(`UPDATE scout_runs SET status=?,completed_at=? WHERE id=? AND run_type='position_backfill'`).run(status,pending?null:now,runId);
  }
  private completePositionBackfillItem(runId:string,positionId:string,outcome:"agent_irrelevant"|"agent_irrelevant_to_review"|"needs_user_review"|"promoted"|"user_workflow_preserved"|"failed"|"unavailable"|"superseded",now:string,failureCode:string|null=null){
    this.db.query(`UPDATE scout_position_backfill_items SET final_outcome=?,failure_code=?,completed_at=? WHERE run_id=? AND position_id=? AND final_outcome IS NULL`).run(outcome,failureCode,now,runId,positionId);
    this.finalizePositionBackfillRun(runId,now);
  }
  backfillStatus(runId:string):ScoutPositionBackfillStatus|null{
    const run=this.db.query(`SELECT operator_reason reason,status,completed_at completedAt FROM scout_runs WHERE id=? AND run_type='position_backfill'`).get(runId) as {reason:string;status:"running"|"completed"|"partial"|"failed";completedAt:string|null}|null;
    if(!run)return null;
    const empty=()=>({pending:0,completed:0,failed:0,superseded:0});
    const stages:Record<ScoutPositionProcessingStage,ReturnType<typeof empty>>={reconcile_gig:empty(),acquire_description:empty(),screen_relevance:empty(),score_candidate_match:empty()};
    for(const row of this.db.query(`SELECT stage,status,count(*) count FROM scout_position_processing WHERE run_id=? GROUP BY stage,status`).all(runId) as Array<{stage:ScoutPositionProcessingStage;status:keyof ReturnType<typeof empty>;count:number}>)stages[row.stage][row.status]=Number(row.count);
    const positions=this.db.query(`SELECT position_id positionId,coalesce(company_name,'unknown') company,coalesce(template_name,'unknown') template,description_outcome descriptionOutcome,coalesce(final_outcome,'pending') outcome,failure_code failureCode FROM scout_position_backfill_items WHERE run_id=? ORDER BY position_id`).all(runId) as ScoutPositionBackfillStatus["positions"];
    const positionOutcomes:Record<string,number>={};
    for(const position of positions)positionOutcomes[position.outcome]=(positionOutcomes[position.outcome]??0)+1;
    const itemCounts=this.db.query(`SELECT count(*) accepted FROM scout_position_backfill_items WHERE run_id=?`).get(runId) as {accepted:number};
    const accepted=Number(itemCounts.accepted);
    const gigDocuments={pending:0,updated:0,unchanged:0,failed:0};
    const projections=this.db.query(`SELECT i.position_id positionId,x.document_projection_status documentProjectionStatus FROM scout_position_backfill_items i JOIN scout_position_processing x ON x.run_id=i.run_id AND x.position_id=i.position_id AND x.stage='acquire_description' AND x.document_projection_status IS NOT NULL WHERE i.run_id=? AND i.linked_gig_id IS NOT NULL ORDER BY i.position_id`).all(runId) as Array<{positionId:string;documentProjectionStatus:ScoutPromotedDescriptionOutcome|"pending"|"failed"}>;
    for(const projection of projections){
      if(projection.documentProjectionStatus==="updated")gigDocuments.updated++;
      else if(projection.documentProjectionStatus==="unchanged")gigDocuments.unchanged++;
      else if(projection.documentProjectionStatus==="failed")gigDocuments.failed++;
      else gigDocuments.pending++;
    }
    return{runId,reason:run.reason,status:run.status,completedAt:run.completedAt,selection:{requested:accepted,accepted,rejected:0},stages,positionOutcomes,positions,gigDocuments};
  }
  private recoverExistingRelevance(positionId:string,sourceRunId:string,backfillRunId:string,observationId:string,now:string){const row=this.db.query(`SELECT re.input_identity relevanceIdentity,re.decision,re.confidence,criteria.confidence_threshold confidenceThreshold FROM scout_position_processing x JOIN scout_relevance_evaluations re ON re.input_identity=x.input_identity AND re.position_id=x.position_id JOIN scout_relevance_criteria criteria ON criteria.id=re.criteria_id WHERE x.position_id=? AND x.run_id=? AND x.observation_id=? AND x.stage='screen_relevance' AND x.status='completed' ORDER BY re.created_at DESC,re.id DESC LIMIT 1`).get(positionId,sourceRunId,observationId) as {relevanceIdentity:string;decision:"passes_relevance"|"fails_relevance";confidence:number;confidenceThreshold:number}|null;if(!row)return false;if(row.decision==="passes_relevance"||row.confidence<row.confidenceThreshold)this.ensureCurrentCandidateMatch(positionId,row.relevanceIdentity,backfillRunId,observationId,now);return true;}
  private screeningSnapshot(runId:string):RunScreeningSnapshot|null{
    const row=this.db.query(`SELECT run_type runType,screening_cache_key promptCacheKey,candidate_profile_json profileJson,candidate_profile_version profileVersion,candidate_profile_artifact_id profileArtifactId,candidate_profile_hash profileHash,screening_model model,screening_provider provider,screening_model_configuration modelConfiguration FROM scout_runs WHERE id=?`).get(runId) as Record<string,unknown>|null;
    if(!row)return null;
    if(row.runType==="position_backfill"){
      const values=[row.promptCacheKey,row.profileJson,row.profileVersion,row.profileArtifactId,row.profileHash,row.model,row.provider,row.modelConfiguration];
      if(values.some(value=>typeof value!=="string"))throw new Error("Scout position backfill screening snapshot is unavailable.");
      return{profile:JSON.parse(String(row.profileJson)) as unknown,profileVersion:String(row.profileVersion),profileArtifactId:String(row.profileArtifactId),profileHash:String(row.profileHash),model:String(row.model),provider:String(row.provider),modelConfiguration:String(row.modelConfiguration),promptCacheKey:String(row.promptCacheKey),immutable:true};
    }
    if(!this.screening||typeof row.promptCacheKey!=="string")return null;
    const legacy=row.runType==="legacy_backfill";
    if(!legacy&&typeof row.profileJson!=="string")return null;
    return{profile:legacy?this.screening.profile:JSON.parse(String(row.profileJson)) as unknown,profileVersion:legacy?this.screening.profileVersion:String(row.profileVersion),profileArtifactId:legacy?this.screening.profileArtifactId:String(row.profileArtifactId),profileHash:legacy?this.screening.profileHash:String(row.profileHash),model:this.screening.model,provider:this.screening.provider,modelConfiguration:this.screening.modelConfiguration,promptCacheKey:String(row.promptCacheKey),immutable:false};
  }
  private assertScreeningSnapshot(runId:string|null,metrics:ModelResult<unknown>["metrics"]){
    if(!runId)return;
    const snapshot=this.screeningSnapshot(runId);
    if(snapshot?.immutable&&(metrics.model!==snapshot.model||metrics.provider!==snapshot.provider||metrics.modelConfiguration!==snapshot.modelConfiguration))throw new Error("Scout screening result does not match the run screening snapshot.");
  }
  private isPositionBackfillRun(runId:string|null|undefined){return Boolean(runId&&this.db.query(`SELECT 1 FROM scout_runs WHERE id=? AND run_type='position_backfill'`).get(runId));}
  private positionBackfillIdentity(runId:string|null|undefined,inputIdentity:string){return this.isPositionBackfillRun(runId)?createHash("sha256").update(JSON.stringify({runId,inputIdentity})).digest("hex"):inputIdentity;}
  private hasUserOwnedWorkflow(positionId:string){return Boolean(this.db.query(`SELECT 1 FROM scout_position_states s JOIN scout_position_decisions d ON d.id=s.current_decision_id WHERE s.position_id=? AND d.origin='user'`).get(positionId));}
  stage(processingId:string){const row=this.db.query(`SELECT stage FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {stage:ReturnType<ScoutPositionProcessingRepository["stage"]>}|null;return row?.stage??null;}
  screeningModelIdentity(processingId:string):ScoutScreeningModelIdentity|null{const row=this.db.query(`SELECT r.screening_provider provider,r.screening_model model,r.screening_model_configuration modelConfiguration FROM scout_position_processing x JOIN scout_runs r ON r.id=x.run_id AND r.run_type='position_backfill' WHERE x.id=? AND x.status='pending'`).get(processingId) as ScoutScreeningModelIdentity|null;return row??null;}
  descriptionVerificationCandidates(){return this.db.query(`SELECT x.id processingId,c.name company,o.canonical_url sourceUrl,s.settings_json settings FROM scout_position_processing x JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_positions p ON p.id=x.position_id JOIN scout_companies c ON c.id=p.company_id JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_company_configuration_sources s ON s.id=rs.configuration_source_id WHERE x.stage='acquire_description' AND x.status='failed' AND x.failure_code='description_too_large' ORDER BY c.name,x.updated_at DESC`).all() as Array<{processingId:string;company:string;sourceUrl:string;settings:string}>;}
  currentDescriptionVerificationCompanies(){const rows=this.db.query(`SELECT c.id companyId,c.name company,c.current_configuration_id configurationVersionId,s.settings_json settings FROM scout_companies c JOIN scout_company_configuration_sources s ON s.company_configuration_id=c.current_configuration_id AND s.active=1 WHERE c.active=1 ORDER BY c.name,s.source_key`).all() as Array<{companyId:string;company:string;configurationVersionId:string;settings:string}>;const grouped=new Map<string,{companyId:string;company:string;configurationVersionId:string;sources:SourceConfiguration[]}>();for(const row of rows){const current=grouped.get(row.companyId)??{companyId:row.companyId,company:row.company,configurationVersionId:row.configurationVersionId,sources:[]};current.sources.push(JSON.parse(row.settings) as SourceConfiguration);grouped.set(row.companyId,current);}return [...grouped.values()];}
  async verifyLiveDescription(source:SourceConfiguration,position:NormalizedPosition){if(position.description)return{strategy:"search-result-v1"};const plan=this.detailPlan(source,{id:position.externalId,title:position.title,url:position.canonicalUrl});if(!plan)throw new Error("description_acquisition_not_configured");await acquirePlannedDescription(plan,{id:position.externalId,title:position.title},this.descriptionHttp);return{strategy:plan.strategyVersion};}
  private ensureStage(positionId:string,stage:"acquire_description"|"screen_relevance"|"score_candidate_match",inputIdentity:string,now:string,bindings:{runId?:string;observationId?:string;configurationSourceId?:string;descriptionId?:string;criteriaId?:string;relevanceEvaluationId?:string;rubricId?:string}={}){
    const processingId=id("spp",positionId,stage,inputIdentity);this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage=? AND status IN ('pending','failed') AND input_identity<>?`).run(now,positionId,stage,inputIdentity);
    const inserted=this.db.query(`INSERT OR IGNORE INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,description_id,criteria_id,relevance_evaluation_id,rubric_id,stage,input_identity,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(processingId,positionId,bindings.runId??null,bindings.observationId??null,bindings.configurationSourceId??null,bindings.descriptionId??null,bindings.criteriaId??null,bindings.relevanceEvaluationId??null,bindings.rubricId??null,stage,inputIdentity,now,now).changes>0;
    const descriptionAssignment=stage==="acquire_description"?"description_id=?":"description_id=coalesce(?,description_id)";
    const revived=!inserted&&this.db.query(`UPDATE scout_position_processing SET run_id=coalesce(?,run_id),observation_id=coalesce(?,observation_id),configuration_source_id=coalesce(?,configuration_source_id),${descriptionAssignment},criteria_id=coalesce(?,criteria_id),relevance_evaluation_id=coalesce(?,relevance_evaluation_id),rubric_id=coalesce(?,rubric_id),status='pending',attempt_count=0,failure_code=NULL,failure_message=NULL,updated_at=?,completed_at=NULL WHERE id=? AND status='failed'`).run(bindings.runId??null,bindings.observationId??null,bindings.configurationSourceId??null,bindings.descriptionId??null,bindings.criteriaId??null,bindings.relevanceEvaluationId??null,bindings.rubricId??null,now,processingId).changes>0;
    if(inserted)this.db.query(`INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,created_at) VALUES(?,?,?,?)`).run(id("sppo",processingId),processingId,`position:${processingId}`,now);else if(revived)this.db.query(`UPDATE scout_position_processing_outbox SET dispatch_status='pending',dispatched_at=NULL WHERE processing_id=?`).run(processingId);return processingId;
  }
  private ensureCurrentRelevance(positionId:string,now:string,bindings:{runId?:string;observationId?:string}={}){const context=bindings.runId&&bindings.observationId?bindings:this.db.query(`SELECT rc.run_id runId,o.id observationId FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE o.position_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`).get(positionId) as {runId:string;observationId:string}|null;if(!context?.runId||!context.observationId)return;const screening=this.screeningSnapshot(context.runId);if(!screening)return;const row=this.db.query(`SELECT d.id descriptionId,d.markdown_content_hash descriptionHash,rc.id criteriaId,rc.version criteriaVersion,rc.prompt_version promptVersion,o.title,o.location,o.canonical_url officialUrl,s.linked_gig_id linkedGigId FROM scout_position_descriptions d JOIN scout_relevance_criteria rc ON rc.version=(SELECT max(version) FROM scout_relevance_criteria) JOIN scout_position_states s ON s.position_id=d.position_id JOIN scout_position_observations o ON o.id=? WHERE d.position_id=? ORDER BY d.created_at DESC,d.id DESC LIMIT 1`).get(context.observationId,positionId) as {descriptionId:string;descriptionHash:string;criteriaId:string;criteriaVersion:number;promptVersion:string;title:string;location:string|null;officialUrl:string;linkedGigId:string|null}|null;if(!row||row.linkedGigId&&!this.isPositionBackfillRun(context.runId))return;const semanticIdentity=createHash("sha256").update(JSON.stringify({positionId,title:row.title,location:row.location,officialUrl:row.officialUrl,descriptionHash:row.descriptionHash,criteriaVersion:row.criteriaVersion,promptVersion:row.promptVersion,model:screening.model,provider:screening.provider,modelConfiguration:screening.modelConfiguration})).digest("hex"),identity=this.positionBackfillIdentity(context.runId,semanticIdentity);const evaluated=this.db.query(`SELECT 1 FROM scout_relevance_evaluations WHERE input_identity=?`).get(identity);if(!evaluated)this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE position_id=? AND stage='score_candidate_match' AND status IN ('pending','failed')`).run(now,positionId);this.ensureStage(positionId,"screen_relevance",identity,now,{runId:context.runId,observationId:context.observationId,descriptionId:row.descriptionId,criteriaId:row.criteriaId});this.ensureCurrentCandidateMatch(positionId,identity,context.runId,context.observationId,now);}
  private ensureCurrentCandidateMatch(positionId:string,relevanceIdentity:string,runId:string,observationId:string,now:string){const screening=this.screeningSnapshot(runId);if(!screening)return;const row=this.db.query(`SELECT re.id relevanceEvaluationId,r.id rubricId,r.version rubricVersion,r.prompt_version promptVersion FROM scout_relevance_evaluations re JOIN scout_relevance_criteria criteria ON criteria.id=re.criteria_id JOIN scout_candidate_match_rubrics r ON r.version=(SELECT max(version) FROM scout_candidate_match_rubrics) WHERE re.position_id=? AND re.input_identity=? AND (re.decision='passes_relevance' OR re.confidence<criteria.confidence_threshold)`).get(positionId,relevanceIdentity) as {relevanceEvaluationId:string;rubricId:string;rubricVersion:number;promptVersion:string}|null;if(!row)return;const semanticIdentity=this.candidateMatchIdentity(row.relevanceEvaluationId,screening.profileHash,row.rubricVersion,row.promptVersion,screening),identity=this.positionBackfillIdentity(runId,semanticIdentity);this.ensureStage(positionId,"score_candidate_match",identity,now,{runId,observationId,relevanceEvaluationId:row.relevanceEvaluationId,rubricId:row.rubricId});}
  private candidateMatchIdentity(relevanceEvaluationId:string,profileHash:string,rubricVersion:number,promptVersion:string,screening:Pick<ScoutScreeningInputs,"model"|"provider"|"modelConfiguration">){return createHash("sha256").update(JSON.stringify({relevanceEvaluationId,profileHash,rubricVersion,promptVersion,model:screening.model,provider:screening.provider,modelConfiguration:screening.modelConfiguration})).digest("hex");}
  private descriptionIdentity(positionId:string,observationId?:string,configurationSourceId?:string){const row=observationId?this.db.query(`SELECT o.canonical_url url,a.content_hash listingHash,o.title,o.location,s.settings_json settings,s.company_configuration_id configurationId FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id JOIN scout_company_configuration_sources s ON s.id=coalesce(?,rs.configuration_source_id) LEFT JOIN scout_description_artifacts a ON a.id=o.description_artifact_id WHERE o.id=? AND o.position_id=?`).get(configurationSourceId??null,observationId,positionId) as Record<string,unknown>|null:null;return createHash("sha256").update(JSON.stringify({url:row?.url,title:row?.title,location:row?.location,listingHash:row?.listingHash,configurationId:row?.configurationId,settings:row?.settings,converterVersion:scoutDescriptionConverterVersion})).digest("hex");}
  private detailPlan(source:SourceConfiguration,position:{id:string|null;title:string;url:string}):DetailDescriptionPlan|null{return resolveDetailDescriptionPlan(source,position,this.templates);}
  descriptionInput(processingId:string):ScoutDescriptionInput{const row=this.db.query(`SELECT r.run_type runType,x.description_id preparedDescriptionId,p.id positionId,p.external_id externalId,o.title,c.name company,o.location,o.canonical_url officialUrl,s.settings_json settings,d.id existingDescriptionId FROM scout_position_processing x JOIN scout_runs r ON r.id=x.run_id JOIN scout_positions p ON p.id=x.position_id JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_company_configuration_sources s ON s.id=coalesce(x.configuration_source_id,rs.configuration_source_id) LEFT JOIN scout_position_descriptions d ON d.position_id=p.id AND d.artifact_id=o.description_artifact_id WHERE x.id=? AND x.stage='acquire_description' AND x.status IN ('pending','failed')`).get(processingId) as Record<string,unknown>|null;if(!row)throw new Error("Scout description work not found.");const source=JSON.parse(String(row.settings)) as SourceConfiguration;const position={id:nullableText(row.externalId),title:String(row.title),url:String(row.officialUrl)},preparedDescriptionId=nullableText(row.preparedDescriptionId),existingDescriptionId=preparedDescriptionId??(row.runType==="position_backfill"?null:nullableText(row.existingDescriptionId));return{positionId:String(row.positionId),externalId:position.id,title:position.title,company:String(row.company),location:nullableText(row.location),officialUrl:position.url,existingDescriptionId,detailPlan:existingDescriptionId?null:this.detailPlan(source,position)};}
  async acquireDescription(input:ScoutDescriptionInput){if(input.existingDescriptionId)return{markdown:"",sourceContentHash:"",sourceUrl:input.officialUrl,retrievedAt:new Date().toISOString(),converterVersion:scoutDescriptionConverterVersion,reusedDescriptionId:input.existingDescriptionId};if(!input.detailPlan)throw new Error("description_acquisition_not_configured");return acquirePlannedDescription(input.detailPlan,{id:input.externalId,title:input.title},this.descriptionHttp);}
  private writeDescriptionArtifact(markdown:string,provenance:unknown,now:string){if(!this.descriptionsRoot)throw new Error("Scout description artifact storage is unavailable.");const hash=createHash("sha256").update(markdown).digest("hex"),artifactId=`sdesc_${hash}`,relative=path.join(hash.slice(0,2),`${hash}.md`),target=path.resolve(this.descriptionsRoot,relative),root=path.resolve(this.descriptionsRoot);if(!target.startsWith(`${root}${path.sep}`))throw new Error("Unsafe Scout description path.");mkdirSync(path.dirname(target),{recursive:true});const temporary=`${target}.${crypto.randomUUID()}.tmp`;writeFileSync(temporary,markdown,{encoding:"utf8",mode:0o600});renameSync(temporary,target);this.db.query(`INSERT OR IGNORE INTO scout_description_artifacts(id,file_path,content_hash,media_type,byte_count,provenance_json,created_at) VALUES(?,?,?,'text/markdown',?,?,?)`).run(artifactId,relative,hash,Buffer.byteLength(markdown),JSON.stringify(provenance),now);return{artifactId,hash};}
  prepareDescriptionCompletion(processingId:string,value:ScoutDescriptionResult,now:string):{descriptionId:string;promotedDocument:ScoutPromotedDescriptionWork|null}{return this.db.transaction(()=>{
    const work=this.db.query(`SELECT x.position_id positionId,x.run_id runId,x.observation_id observationId,x.description_id descriptionId,r.run_type runType FROM scout_position_processing x JOIN scout_runs r ON r.id=x.run_id WHERE x.id=? AND x.stage='acquire_description' AND x.status='pending'`).get(processingId) as {positionId:string;runId:string;observationId:string|null;descriptionId:string|null;runType:string}|null;
    if(!work)throw new Error("Scout description work is no longer pending.");
    let descriptionId=work.descriptionId,descriptionOutcome:"corrected"|"unchanged"|null=null;
    if(descriptionId){if(value.reusedDescriptionId&&value.reusedDescriptionId!==descriptionId)throw new Error("Prepared Scout description replay does not match durable work.");}
    else{
      if(work.runType==="position_backfill"&&value.reusedDescriptionId)throw new Error("Scout position backfill requires an authoritative refetch.");
      descriptionId=value.reusedDescriptionId??null;
      if(!descriptionId){
        const artifact=this.writeDescriptionArtifact(value.markdown,{sourceUrl:value.sourceUrl,retrievedAt:value.retrievedAt,sourceContentHash:value.sourceContentHash,extractedContentHash:value.extractedContentHash,strategyVersion:value.strategyVersion,template:value.template,converterVersion:value.converterVersion},now);
        descriptionId=id("spdesc",work.positionId,artifact.hash,value.converterVersion);
        descriptionOutcome=this.db.query(`SELECT 1 FROM scout_position_descriptions WHERE id=?`).get(descriptionId)?"unchanged":"corrected";
        this.db.query(`INSERT OR IGNORE INTO scout_position_descriptions(id,position_id,artifact_id,source_url,retrieved_at,source_content_hash,markdown_content_hash,converter_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(descriptionId,work.positionId,artifact.artifactId,value.sourceUrl,value.retrievedAt,value.sourceContentHash,artifact.hash,value.converterVersion,now);
        if(work.observationId)this.db.query(`UPDATE scout_position_observations SET description_artifact_id=? WHERE id=? AND description_artifact_id IS NULL`).run(artifact.artifactId,work.observationId);
      }
      this.db.query(`UPDATE scout_position_processing SET description_id=?,failure_code=NULL,failure_message=NULL,updated_at=? WHERE id=? AND status='pending' AND description_id IS NULL`).run(descriptionId,now,processingId);
    }
    if(work.runType==="position_backfill"&&!value.reusedDescriptionId){
      const extractedContentHash=value.extractedContentHash??"",extractionStrategy=value.strategyVersion??"";
      if(!/^[0-9a-f]{64}$/.test(value.sourceContentHash)||!/^https:\/\//.test(value.sourceUrl)||!/^[0-9a-f]{64}$/.test(extractedContentHash)||!extractionStrategy||!value.converterVersion)throw new Error("Scout description acquisition provenance is incomplete.");
      const configuration=this.db.query(`SELECT source.source_key sourceKey,configuration.version configurationVersion FROM scout_position_processing processing JOIN scout_company_configuration_sources source ON source.id=processing.configuration_source_id JOIN scout_company_configurations configuration ON configuration.id=source.company_configuration_id WHERE processing.id=?`).get(processingId) as {sourceKey:string;configurationVersion:number}|null;
      if(!configuration)throw new Error("Scout description acquisition configuration is unavailable.");
      this.db.query(`INSERT OR IGNORE INTO scout_description_acquisitions(processing_id,description_id,source_url,retrieved_at,source_content_hash,extracted_content_hash,source_key,configuration_version,extraction_strategy,converter_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(processingId,descriptionId,value.sourceUrl,value.retrievedAt,value.sourceContentHash,extractedContentHash,configuration.sourceKey,configuration.configurationVersion,extractionStrategy,value.converterVersion,now);
      if(descriptionOutcome)this.db.query(`UPDATE scout_position_backfill_items SET description_outcome=? WHERE run_id=? AND position_id=?`).run(descriptionOutcome,work.runId,work.positionId);
    }
    const promotedDocument=this.promotedDescriptionWork(processingId,descriptionId);
    if(promotedDocument)this.db.query(`UPDATE scout_position_processing SET document_projection_status='pending',updated_at=? WHERE id=? AND status='pending'`).run(now,processingId);
    return{descriptionId,promotedDocument};
  })();}
  completeDescription(processingId:string,descriptionOrValue:string|ScoutDescriptionResult,documentOutcomeOrNow:ScoutPromotedDescriptionOutcome|null|string,completedAt?:string){
    if(typeof descriptionOrValue!=="string"){
      const now=String(documentOutcomeOrNow),prepared=this.prepareDescriptionCompletion(processingId,descriptionOrValue,now);
      if(prepared.promotedDocument)throw new Error("Promoted Scout description requires managed-document projection.");
      this.completeDescription(processingId,prepared.descriptionId,null,now);return;
    }
    const descriptionId=descriptionOrValue,documentOutcome=documentOutcomeOrNow as ScoutPromotedDescriptionOutcome|null,now=completedAt!;
    this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,observation_id observationId,description_id descriptionId FROM scout_position_processing WHERE id=? AND stage='acquire_description' AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;observationId:string|null;descriptionId:string|null}|null;if(!work)return;if(work.descriptionId!==descriptionId)throw new Error("Scout description completion does not match durable preparation.");const promotedDocument=this.promotedDescriptionWork(processingId,descriptionId);if(Boolean(promotedDocument)!==Boolean(documentOutcome))throw new Error("Scout promoted-description outcome does not match durable work.");this.ensureCurrentRelevance(work.positionId,now,{runId:work.runId??undefined,observationId:work.observationId??undefined});this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,failure_code=NULL,failure_message=NULL,document_projection_status=?,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(documentOutcome,now,now,processingId);})();
  }
  failDescriptionProjection(processingId:string,code:string,message:string,now:string){const boundedCode=code.trim().replace(/[^a-z0-9_]+/gi,"_").slice(0,70)||"failed",failureCode=boundedCode.startsWith("document_projection_")?boundedCode:`document_projection_${boundedCode}`;this.db.query(`UPDATE scout_position_processing SET attempt_count=attempt_count+1,failure_code=?,failure_message=?,document_projection_status='failed',updated_at=?,completed_at=NULL WHERE id=? AND stage='acquire_description' AND status='pending' AND description_id IS NOT NULL`).run(failureCode.slice(0,100),message.slice(0,500),now,processingId);}
  private promotedDescriptionWork(processingId:string,descriptionId:string):ScoutPromotedDescriptionWork|null{
    const row=this.db.query(`SELECT x.id processingId,x.position_id positionId,i.linked_gig_id gigId,prom.managed_document_id managedDocumentId,artifact.file_path filePath,acquisition.source_url officialUrl,acquisition.retrieved_at retrievedAt,acquisition.source_content_hash sourceContentHash,acquisition.extracted_content_hash extractedContentHash,acquisition.source_key sourceKey,acquisition.configuration_version configurationVersion,acquisition.extraction_strategy extractionStrategy,acquisition.converter_version converterVersion FROM scout_position_processing x JOIN scout_runs run ON run.id=x.run_id AND run.run_type='position_backfill' JOIN scout_position_backfill_items i ON i.run_id=x.run_id AND i.position_id=x.position_id JOIN scout_position_states state ON state.position_id=x.position_id AND state.linked_gig_id=i.linked_gig_id JOIN scout_position_promotions prom ON prom.position_id=x.position_id AND prom.status='completed' AND prom.gig_id=i.linked_gig_id AND prom.managed_document_id IS NOT NULL JOIN scout_position_descriptions d ON d.id=x.description_id AND d.id=? AND d.position_id=x.position_id JOIN scout_description_artifacts artifact ON artifact.id=d.artifact_id JOIN scout_description_acquisitions acquisition ON acquisition.processing_id=x.id AND acquisition.description_id=d.id WHERE x.id=? AND i.linked_gig_id IS NOT NULL`).get(descriptionId,processingId) as Record<string,unknown>|null;
    if(!row)return null;
    if(!this.descriptionsRoot)throw new Error("Scout description artifact storage is unavailable.");
    const extractedContentHash=String(row.extractedContentHash),extractionStrategy=String(row.extractionStrategy);
    if(!/^[0-9a-f]{64}$/.test(extractedContentHash)||!extractionStrategy)throw new Error("Promoted Scout description provenance is incomplete.");
    const configurationVersion=Number(row.configurationVersion),sourceKey=String(row.sourceKey),sourceDescription=`Gig Scout official posting retrieved from ${sourceKey} configuration ${configurationVersion}.`;
    if(sourceDescription.length>500)throw new Error("Promoted Scout description source exceeds the managed-document source limit.");
    return{processingId:String(row.processingId),positionId:String(row.positionId),gigId:String(row.gigId),managedDocumentId:String(row.managedDocumentId),markdown:readFileSync(path.resolve(this.descriptionsRoot,String(row.filePath)),"utf8"),sourceDescription,sourceProvenance:{officialUrl:String(row.officialUrl),retrievedAt:String(row.retrievedAt),sourceContentHash:String(row.sourceContentHash),extractedContentHash,sourceKey,configurationVersion,extractionStrategy,converterVersion:String(row.converterVersion)},documentChangeId:id("change","promoted-description",processingId)};
  }
  private recordAgentIrrelevance(processingId:string,positionId:string,descriptionId:string,evaluationId:string,reason:string,now:string){
    const state=this.db.query(`SELECT revision,linked_gig_id linkedGigId FROM scout_position_states WHERE position_id=?`).get(positionId) as {revision:number;linkedGigId:string|null}|null;
    if(!state||state.linkedGigId)return;
    const changeId=id("change","agent-irrelevant",processingId),decisionId=id("spdec",changeId),nextRevision=state.revision+1;
    this.db.query(`INSERT OR IGNORE INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,'Gig Scout','automation','Agent marked Scout position irrelevant','committed')`).run(changeId,now);
    this.db.query(`INSERT OR IGNORE INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,reason,description_id,relevance_evaluation_id,expected_state_revision,resulting_state_revision,created_at) VALUES(?,?,?,'irrelevant','agent','Gig Scout',?,?,?,?,?,?)`).run(decisionId,changeId,positionId,reason,descriptionId,evaluationId,state.revision,nextRevision,now);
    this.db.query(`INSERT INTO scout_position_state_history(change_id,operation,recorded_at,recorded_by,position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at,current_decision_id) SELECT ?,'update',?,'Gig Scout',position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at,current_decision_id FROM scout_position_states WHERE position_id=?`).run(changeId,now,positionId);
    this.db.query(`UPDATE scout_position_states SET state='irrelevant',current_decision_id=?,revision=?,updated_at=? WHERE position_id=? AND linked_gig_id IS NULL`).run(decisionId,nextRevision,now,positionId);
  }
  private completeSuccessfulPositionBackfill(runId:string|null,positionId:string,projection:"irrelevant"|"review",preserveUserWorkflow:boolean,now:string){
    if(!runId||!this.isPositionBackfillRun(runId))return;
    const item=this.db.query(`SELECT linked_gig_id linkedGigId,initial_state initialState,initial_decision_origin initialDecisionOrigin FROM scout_position_backfill_items WHERE run_id=? AND position_id=?`).get(runId,positionId) as {linkedGigId:string|null;initialState:string|null;initialDecisionOrigin:string|null}|null;
    if(!item)return;
    const outcome=item.linkedGigId?"promoted":preserveUserWorkflow?"user_workflow_preserved":projection==="irrelevant"?"agent_irrelevant":item.initialState==="irrelevant"&&item.initialDecisionOrigin==="agent"?"agent_irrelevant_to_review":"needs_user_review";
    this.completePositionBackfillItem(runId,positionId,outcome,now);
  }
  relevanceInput(processingId:string):RelevanceRequest&{confidenceThreshold:number}{const row=this.db.query(`SELECT x.run_id runId,p.id positionId,o.title,c.name company,o.location,o.canonical_url officialUrl,d.id descriptionId,d.artifact_id descriptionArtifactId,d.markdown_content_hash descriptionHash,a.file_path filePath,rc.criteria,rc.version criteriaVersion,rc.confidence_threshold confidenceThreshold,rc.prompt_version promptVersion FROM scout_position_processing x JOIN scout_positions p ON p.id=x.position_id JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_position_descriptions d ON d.id=x.description_id JOIN scout_description_artifacts a ON a.id=d.artifact_id JOIN scout_relevance_criteria rc ON rc.id=x.criteria_id WHERE x.id=? AND x.status='pending'`).get(processingId) as Record<string,unknown>|null;if(!row||typeof row.runId!=="string"||!this.screeningSnapshot(row.runId)||!this.descriptionsRoot)throw new Error("Scout relevance inputs are unavailable.");return{positionId:String(row.positionId),title:String(row.title),company:String(row.company),location:nullableText(row.location),officialUrl:String(row.officialUrl),descriptionMarkdown:readFileSync(path.resolve(this.descriptionsRoot,String(row.filePath)),"utf8"),descriptionArtifactId:String(row.descriptionArtifactId),descriptionHash:String(row.descriptionHash),criteria:String(row.criteria),criteriaVersion:Number(row.criteriaVersion),confidenceThreshold:Number(row.confidenceThreshold)/1000,promptVersion:String(row.promptVersion)};}
  completeRelevance(processingId:string,result:ModelResult<RelevanceResult>,irrelevant:boolean,now:string){this.db.transaction(()=>{const work=this.db.query(`SELECT position_id positionId,run_id runId,observation_id observationId,input_identity inputIdentity,description_id descriptionId,criteria_id criteriaId FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {positionId:string;runId:string|null;observationId:string|null;inputIdentity:string;descriptionId:string;criteriaId:string}|null;if(!work)return;this.assertScreeningSnapshot(work.runId,result.metrics);const evaluationId=id("sre",work.inputIdentity),preserveUserWorkflow=this.isPositionBackfillRun(work.runId)&&this.hasUserOwnedWorkflow(work.positionId);this.db.query(`INSERT OR IGNORE INTO scout_relevance_evaluations(id,position_id,description_id,criteria_id,input_identity,decision,reason,confidence,evidence_json,ambiguities_json,provider,model,model_configuration,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evaluationId,work.positionId,work.descriptionId,work.criteriaId,work.inputIdentity,result.value.decision,result.value.reason,Math.round(result.value.confidence*1000),JSON.stringify(result.value.evidence),JSON.stringify(result.value.ambiguities),result.metrics.provider,result.metrics.model,result.metrics.modelConfiguration,result.metrics.inputTokens,result.metrics.outputTokens,result.metrics.cacheReadTokens??null,result.metrics.cacheWriteTokens??null,result.metrics.latencyMs,now);if(irrelevant){if(!preserveUserWorkflow)this.recordAgentIrrelevance(processingId,work.positionId,work.descriptionId,evaluationId,result.value.reason,now);}else if(work.runId&&work.observationId)this.ensureCurrentCandidateMatch(work.positionId,work.inputIdentity,work.runId,work.observationId,now);this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(now,now,processingId);if(irrelevant)this.completeSuccessfulPositionBackfill(work.runId,work.positionId,"irrelevant",preserveUserWorkflow,now);})();}
  candidateMatchInput(processingId:string):CandidateMatchRequest{
    if(!this.descriptionsRoot)throw new Error("Scout candidate profile is unavailable.");
    const row=this.db.query(`SELECT sr.id runId,p.id positionId,o.title,c.name company,o.location,o.canonical_url officialUrl,d.artifact_id descriptionArtifactId,d.markdown_content_hash descriptionHash,a.file_path filePath,re.id relevanceEvaluationId,r.rubric,r.version rubricVersion,r.prompt_version promptVersion
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
    const screening=row&&typeof row.runId==="string"?this.screeningSnapshot(row.runId):null;
    if(!row||!screening)throw new Error("Scout candidate-match inputs are unavailable.");
    return{positionId:String(row.positionId),title:String(row.title),company:String(row.company),location:nullableText(row.location),officialUrl:String(row.officialUrl),descriptionMarkdown:readFileSync(path.resolve(this.descriptionsRoot,String(row.filePath)),"utf8"),descriptionArtifactId:String(row.descriptionArtifactId),descriptionHash:String(row.descriptionHash),profile:screening.profile,profileVersion:screening.profileVersion,profileArtifactId:screening.profileArtifactId,profileHash:screening.profileHash,promptCacheKey:screening.promptCacheKey,rubric:String(row.rubric),rubricVersion:Number(row.rubricVersion),promptVersion:String(row.promptVersion),relevanceEvaluationId:String(row.relevanceEvaluationId)};
  }
  refreshCandidateMatch(processingId:string,now:string){const screening=this.screening;if(!screening)return false;return this.db.transaction(()=>{const row=this.db.query(`SELECT x.position_id positionId,x.observation_id observationId,x.input_identity inputIdentity,re.input_identity relevanceIdentity,re.id relevanceEvaluationId,r.version rubricVersion,r.prompt_version promptVersion,sr.id runId,sr.run_type runType FROM scout_position_processing x JOIN scout_relevance_evaluations re ON re.id=x.relevance_evaluation_id JOIN scout_candidate_match_rubrics r ON r.id=x.rubric_id JOIN scout_runs sr ON sr.id=x.run_id WHERE x.id=? AND x.stage='score_candidate_match' AND x.status='pending'`).get(processingId) as {positionId:string;observationId:string;inputIdentity:string;relevanceIdentity:string;relevanceEvaluationId:string;rubricVersion:number;promptVersion:string;runId:string;runType:string}|null;if(!row||row.runType!=="legacy_backfill")return false;const current=this.candidateMatchIdentity(row.relevanceEvaluationId,screening.profileHash,row.rubricVersion,row.promptVersion,screening);if(current===row.inputIdentity)return false;this.db.query(`UPDATE scout_position_processing SET status='superseded',updated_at=? WHERE id=? AND status='pending'`).run(now,processingId);this.ensureCurrentCandidateMatch(row.positionId,row.relevanceIdentity,row.runId,row.observationId,now);return true;})();}
  completeCandidateMatch(processingId:string,result:ModelResult<CandidateMatchResult>,now:string){this.db.transaction(()=>{const input=this.candidateMatchInput(processingId),work=this.db.query(`SELECT run_id runId,input_identity inputIdentity,rubric_id rubricId FROM scout_position_processing WHERE id=? AND status='pending'`).get(processingId) as {runId:string|null;inputIdentity:string;rubricId:string}|null;if(!work)return;this.assertScreeningSnapshot(work.runId,result.metrics);const preserveUserWorkflow=this.isPositionBackfillRun(work.runId)&&this.hasUserOwnedWorkflow(input.positionId);this.db.query(`INSERT OR IGNORE INTO scout_candidate_match_evaluations(id,position_id,relevance_evaluation_id,input_identity,profile_version,profile_artifact_id,profile_hash,rubric_id,score,score_explanation,provider,model,model_configuration,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id("scme",work.inputIdentity),input.positionId,input.relevanceEvaluationId,work.inputIdentity,input.profileVersion,input.profileArtifactId,input.profileHash,work.rubricId,result.value.score,result.value.scoreExplanation,result.metrics.provider,result.metrics.model,result.metrics.modelConfiguration,result.metrics.inputTokens,result.metrics.outputTokens,result.metrics.cacheReadTokens??null,result.metrics.cacheWriteTokens??null,result.metrics.latencyMs,now);if(!preserveUserWorkflow)this.db.query(`UPDATE scout_position_states SET state='needs_user_review',current_decision_id=CASE WHEN EXISTS(SELECT 1 FROM scout_position_decisions d WHERE d.id=scout_position_states.current_decision_id AND d.origin='agent') THEN NULL ELSE current_decision_id END,revision=revision+1,updated_at=? WHERE position_id=? AND linked_gig_id IS NULL`).run(now,input.positionId);this.db.query(`UPDATE scout_position_processing SET status='completed',attempt_count=attempt_count+1,updated_at=?,completed_at=? WHERE id=? AND status='pending'`).run(now,now,processingId);this.completeSuccessfulPositionBackfill(work.runId,input.positionId,"review",preserveUserWorkflow,now);})();}

  private materializeDescription(position: NormalizedPosition, now: string, provenance:unknown=position.provenance) {
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
        JSON.stringify(provenance),
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
    return{items:rows.map(row=>({...row,stateRevision:Number((this.db.query(`SELECT revision FROM scout_position_states WHERE position_id=?`).get(row.id) as {revision:number}).revision),descriptionAvailable:Boolean(this.db.query(`SELECT 1 FROM scout_position_descriptions WHERE position_id=? LIMIT 1`).get(row.id)),observationCount:Number(row.observationCount),score:row.score===null?null:Number(row.score)})),offset:input.offset,limit:input.limit,total,counts};
  }
  positionDetail(positionId:string):ScoutPositionDetail|null{const row=this.db.query(`SELECT p.id,p.title,c.name company,p.location,p.canonical_url canonicalUrl,p.external_id externalId,p.source_key sourceKey,s.state,p.first_seen_at firstSeenAt,p.last_seen_at lastSeenAt,(SELECT count(*) FROM scout_position_observations o WHERE o.position_id=p.id) observationCount,EXISTS(SELECT 1 FROM scout_position_observations o WHERE o.position_id=p.id AND o.description_artifact_id IS NOT NULL) descriptionAvailable,(SELECT stage FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingStage,(SELECT status FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingStatus,(SELECT failure_code FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingFailureCode,(SELECT failure_message FROM scout_position_processing x WHERE x.position_id=p.id AND x.status<>'superseded' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) processingFailureMessage,(SELECT m.score FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) score,(SELECT m.score_explanation FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) scoreExplanation,(SELECT rc.version FROM scout_relevance_evaluations re JOIN scout_relevance_criteria rc ON rc.id=re.criteria_id WHERE re.position_id=p.id ORDER BY re.created_at DESC,re.id DESC LIMIT 1) criteriaVersion,(SELECT r.version FROM scout_candidate_match_evaluations m JOIN scout_candidate_match_rubrics r ON r.id=m.rubric_id WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) rubricVersion,(SELECT m.profile_version FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) profileVersion,(SELECT m.model FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) model,(SELECT m.provider FROM scout_candidate_match_evaluations m WHERE m.position_id=p.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) provider FROM scout_positions p JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_states s ON s.position_id=p.id WHERE p.id=? AND s.state NOT IN ('rejected','irrelevant') AND s.linked_gig_id IS NULL`).get(positionId) as (Omit<ScoutPositionDetail,"observations"|"descriptionAvailable"|"observationCount">&{descriptionAvailable:number;observationCount:number})|null;if(!row)return null;const observations=(this.db.query(`SELECT o.id,rc.run_id runId,r.created_at runCreatedAt,rc.status companyStatus,cs.source_key sourceKey,rs.status sourceStatus,o.title,o.canonical_url canonicalUrl,o.location,o.observed_at observedAt,o.description_artifact_id IS NOT NULL descriptionAvailable,o.provenance_json provenance FROM scout_position_observations o JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_company_configuration_sources cs ON cs.id=rs.configuration_source_id JOIN scout_run_companies rc ON rc.id=rs.run_company_id JOIN scout_runs r ON r.id=rc.run_id WHERE o.position_id=? ORDER BY o.observed_at DESC,o.id DESC`).all(positionId) as Array<Omit<ScoutPositionDetail["observations"][number],"descriptionAvailable"|"provenance">&{descriptionAvailable:number;provenance:string}>).map(value=>({...value,descriptionAvailable:Boolean(value.descriptionAvailable),provenance:JSON.parse(value.provenance) as unknown}));return{...row,descriptionAvailable:Boolean(this.db.query(`SELECT 1 FROM scout_position_descriptions WHERE position_id=? LIMIT 1`).get(positionId)),observationCount:Number(row.observationCount),score:row.score===null?null:Number(row.score),observations} as ScoutPositionDetail;}
  reviewDetail(positionId:string):ScoutPositionDetail|null{
    const base=this.positionDetail(positionId);if(!base)return null;
    const state=this.db.query(`SELECT revision,current_decision_id currentDecisionId FROM scout_position_states WHERE position_id=?`).get(positionId) as {revision:number;currentDecisionId:string|null};
    const evaluation=this.db.query(`SELECT d.id descriptionId,d.source_url descriptionSourceUrl,d.retrieved_at descriptionRetrievedAt,a.file_path filePath,a.provenance_json descriptionProvenance,r.id relevanceEvaluationId,r.reason relevanceReason,m.id candidateMatchEvaluationId FROM scout_position_descriptions d JOIN scout_description_artifacts a ON a.id=d.artifact_id JOIN scout_relevance_evaluations r ON r.description_id=d.id JOIN scout_candidate_match_evaluations m ON m.relevance_evaluation_id=r.id WHERE d.position_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(positionId) as Record<string,unknown>|null;
    const decision=state.currentDecisionId?this.db.query(`SELECT origin FROM scout_position_decisions WHERE id=?`).get(state.currentDecisionId) as {origin:"agent"|"user"}|null:null;
    const promotion=this.db.query(`SELECT status,failure_code failureCode,failure_message failureMessage FROM scout_position_promotions WHERE position_id=?`).get(positionId) as {status:"pending"|"completed"|"failed";failureCode:string|null;failureMessage:string|null}|null;
    Object.assign(base,{promotionStatus:promotion?.status??null,promotionFailureCode:promotion?.failureCode??null,promotionFailureMessage:promotion?.failureMessage??null});
    return{...base,stateRevision:state.revision,descriptionId:nullableText(evaluation?.descriptionId),descriptionMarkdown:evaluation&&this.descriptionsRoot?readFileSync(path.resolve(this.descriptionsRoot,String(evaluation.filePath)),"utf8"):null,descriptionSourceUrl:nullableText(evaluation?.descriptionSourceUrl),descriptionRetrievedAt:nullableText(evaluation?.descriptionRetrievedAt),descriptionProvenance:evaluation?JSON.parse(String(evaluation.descriptionProvenance)):null,relevanceEvaluationId:nullableText(evaluation?.relevanceEvaluationId),relevanceReason:nullableText(evaluation?.relevanceReason),candidateMatchEvaluationId:nullableText(evaluation?.candidateMatchEvaluationId),irrelevanceOrigin:decision?.origin??null};
  }
  decide(command:ScoutUserDecisionCommand,now:string):ScoutPositionDetail{
    const _decisionId=this.db.transaction(()=>{
    const current=this.db.query(`SELECT state,revision,linked_gig_id linkedGigId FROM scout_position_states WHERE position_id=?`).get(command.positionId) as {state:string;revision:number;linkedGigId:string|null}|null;
    if(!current)throw new Error("Scout position not found.");
    const existing=this.db.query(`SELECT position_id positionId FROM scout_position_decisions WHERE change_id=?`).get(command.changeId) as {positionId:string}|null;
    if(existing){if(existing.positionId!==command.positionId)throw new Error("Decision change ID is already used.");return id("spdec",command.changeId);}
    if(current.revision!==command.expectedStateRevision)throw new Error("This position was revised and requires review again.");
    if(current.state!=="needs_user_review"||current.linkedGigId)throw new Error("This position no longer needs user review.");
    const identities=this.db.query(`SELECT d.id descriptionId,r.id relevanceEvaluationId,m.id candidateMatchEvaluationId FROM scout_position_descriptions d JOIN scout_relevance_evaluations r ON r.description_id=d.id JOIN scout_candidate_match_evaluations m ON m.relevance_evaluation_id=r.id WHERE d.position_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(command.positionId) as {descriptionId:string;relevanceEvaluationId:string;candidateMatchEvaluationId:string}|null;
    if(!identities||identities.descriptionId!==command.descriptionId||identities.relevanceEvaluationId!==command.relevanceEvaluationId||identities.candidateMatchEvaluationId!==command.candidateMatchEvaluationId)throw new Error("This position was revised and requires review again.");
    const decisionId=id("spdec",command.changeId),next=current.revision+1;
    this.db.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,?,'web',?,'committed')`).run(command.changeId,now,command.actor,`Scout position ${command.action}`);
    this.db.query(`INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,note,description_id,relevance_evaluation_id,candidate_match_evaluation_id,expected_state_revision,resulting_state_revision,review_at,created_at) VALUES(?,?,?,?,'user',?,?,?,?,?,?,?,?,?)`).run(decisionId,command.changeId,command.positionId,command.action,command.actor,command.note??null,command.descriptionId,command.relevanceEvaluationId,command.candidateMatchEvaluationId,current.revision,next,command.reviewAt??null,now);
    this.db.query(`INSERT INTO scout_position_state_history(change_id,operation,recorded_at,recorded_by,position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at,current_decision_id) SELECT ?,'update',?,?,position_id,state,linked_gig_id,deferred_until,revision,created_at,updated_at,current_decision_id FROM scout_position_states WHERE position_id=?`).run(command.changeId,now,command.actor,command.positionId);
    const state=command.action==="irrelevant"?"irrelevant":command.action==="defer"?"deferred":"processing";
    this.db.query(`UPDATE scout_position_states SET state=?,deferred_until=?,current_decision_id=?,revision=?,updated_at=? WHERE position_id=?`).run(state,command.action==="defer"?(command.reviewAt??null):null,decisionId,next,now,command.positionId);
    if(command.action==="pursue")this.db.query(`INSERT OR IGNORE INTO scout_position_promotions(id,decision_id,position_id,description_id,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)`).run(id("spprom",command.positionId),decisionId,command.positionId,command.descriptionId,now,now);
    return decisionId;
  })();
    return this.reviewDetail(command.positionId)??this.positionDetail(command.positionId)!;
  }
  promotionWork(positionId:string):ScoutPromotionWork|null {
    const source=this.db.query(`SELECT p.id positionId,p.title,p.location,p.external_id externalId,p.canonical_url canonicalUrl,p.source_key positionSourceKey,c.name company,prom.description_id descriptionId,d.source_url sourceUrl,d.retrieved_at retrievedAt,a.file_path filePath,a.provenance_json provenance,decision.change_id changeId,decision.actor,(SELECT cs.source_key FROM scout_position_processing x JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_company_configuration_sources cs ON cs.id=rs.configuration_source_id WHERE x.description_id=d.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) authoritativeSourceKey,(SELECT cs.company_configuration_id FROM scout_position_processing x JOIN scout_position_observations o ON o.id=x.observation_id JOIN scout_run_sources rs ON rs.id=o.run_source_id JOIN scout_company_configuration_sources cs ON cs.id=rs.configuration_source_id WHERE x.description_id=d.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) configurationVersionId FROM scout_position_promotions prom JOIN scout_position_decisions decision ON decision.id=prom.decision_id JOIN scout_positions p ON p.id=prom.position_id JOIN scout_companies c ON c.id=p.company_id JOIN scout_position_descriptions d ON d.id=prom.description_id AND d.position_id=p.id JOIN scout_description_artifacts a ON a.id=d.artifact_id WHERE prom.position_id=? AND prom.status IN ('pending','failed')`).get(positionId) as Record<string,unknown>|null;
    if(!source)return null;
    if(!this.descriptionsRoot)throw new Error("Reviewed Scout description promotion is unavailable.");
    const provenance=JSON.parse(String(source.provenance)) as Record<string,unknown>;
    const sourceDescription=JSON.stringify({scoutDescriptionId:String(source.descriptionId),officialSourceUrl:String(source.sourceUrl??source.canonicalUrl),retrievedAt:String(source.retrievedAt),sourceKey:String(source.authoritativeSourceKey??source.positionSourceKey),configurationVersionId:nullableText(source.configurationVersionId),extractionStrategy:provenance.extractionStrategy??provenance.strategyVersion,converterVersion:provenance.converterVersion});
    if(sourceDescription.length>500)throw new Error("Reviewed Scout description provenance exceeds the managed-document source limit.");
    return {positionId:String(source.positionId),descriptionId:String(source.descriptionId),changeId:String(source.changeId),actor:String(source.actor),gigId:id("gig","scout",positionId),company:String(source.company),title:String(source.title),externalId:nullableText(source.externalId),location:nullableText(source.location),sourceUrl:String(source.sourceUrl??source.canonicalUrl),markdown:readFileSync(path.resolve(this.descriptionsRoot,String(source.filePath)),"utf8"),sourceDescription};
  }
  failPromotion(positionId:string,message:string,now:string){this.db.query(`UPDATE scout_position_promotions SET status='failed',failure_code='promotion_failed',failure_message=?,attempt_count=attempt_count+1,updated_at=? WHERE position_id=? AND status<>'completed'`).run(message.slice(0,500),now,positionId);}
  completePromotion(positionId:string,gigId:string,managedDocumentId:string,now:string){this.db.transaction(()=>{const completed=this.db.query(`UPDATE scout_position_promotions SET gig_id=?,managed_document_id=?,status='completed',failure_code=NULL,failure_message=NULL,attempt_count=attempt_count+1,updated_at=?,completed_at=? WHERE position_id=? AND status IN ('pending','failed')`).run(gigId,managedDocumentId,now,now,positionId);if(completed.changes!==1)throw new Error("Scout promotion is no longer pending.");this.db.query(`UPDATE scout_position_states SET state='promoted',linked_gig_id=?,deferred_until=NULL,updated_at=? WHERE position_id=?`).run(gigId,now,positionId);})();}
  restoreAgentIrrelevant(input:{positionId:string;changeId:string;actor:string;expectedStateRevision:number},now:string):ScoutPositionDetail{return this.db.transaction(()=>{const state=this.db.query(`SELECT s.revision,d.id decisionId,d.origin FROM scout_position_states s JOIN scout_position_decisions d ON d.id=s.current_decision_id WHERE s.position_id=? AND s.state='irrelevant'`).get(input.positionId) as {revision:number;decisionId:string;origin:string}|null;if(!state||state.origin!=="agent")throw new Error("Only agent-marked irrelevance can be restored directly.");if(state.revision!==input.expectedStateRevision)throw new Error("This position was revised and requires review again.");const decisionId=id("spdec",input.changeId);this.db.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,?,'web','Restored agent-irrelevant Scout position','committed')`).run(input.changeId,now,input.actor);this.db.query(`INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,expected_state_revision,resulting_state_revision,created_at) VALUES(?,?,?,'restore','user',?,?,?,?)`).run(decisionId,input.changeId,input.positionId,input.actor,state.revision,state.revision+1,now);this.db.query(`UPDATE scout_position_states SET state='needs_user_review',current_decision_id=?,revision=revision+1,updated_at=? WHERE position_id=?`).run(decisionId,now,input.positionId);return this.positionDetail(input.positionId)!;})();}
  reverseDecision(input:{positionId:string;decisionId:string;changeId:string;actor:string;expectedStateRevision:number},now:string):ScoutPositionDetail{return this.db.transaction(()=>{const state=this.db.query(`SELECT revision,linked_gig_id linkedGigId FROM scout_position_states WHERE position_id=?`).get(input.positionId) as {revision:number;linkedGigId:string|null}|null;const original=this.db.query(`SELECT id,origin FROM scout_position_decisions WHERE id=? AND position_id=?`).get(input.decisionId,input.positionId) as {id:string;origin:string}|null;if(!state||!original||original.origin!=="user")throw new Error("User decision not found.");if(state.revision!==input.expectedStateRevision)throw new Error("This position was revised and requires review again.");const decisionId=id("spdec",input.changeId);this.db.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,?,'backend','Reversed Scout position decision','committed')`).run(input.changeId,now,input.actor);this.db.query(`INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,expected_state_revision,resulting_state_revision,reverses_decision_id,created_at) VALUES(?,?,?,'reverse','user',?,?,?,?,?)`).run(decisionId,input.changeId,input.positionId,input.actor,state.revision,state.revision+1,input.decisionId,now);this.db.query(`UPDATE scout_position_states SET state=CASE WHEN linked_gig_id IS NULL THEN 'needs_user_review' ELSE 'promoted' END,deferred_until=NULL,current_decision_id=?,revision=revision+1,updated_at=? WHERE position_id=?`).run(decisionId,now,input.positionId);return this.positionDetail(input.positionId)!;})();}
  appendPositionNote(input:{positionId:string;decisionId?:string;actor:string;body:string},now:string){this.db.query(`INSERT INTO scout_position_notes(id,position_id,decision_id,actor,body,created_at) VALUES(?,?,?,?,?,?)`).run(`spnote_${crypto.randomUUID()}`,input.positionId,input.decisionId??null,input.actor,input.body,now);}
  resurfaceDue(now:string){return this.db.transaction(()=>{const due=this.db.query(`SELECT position_id positionId,revision FROM scout_position_states WHERE state='deferred' AND deferred_until<=?`).all(now) as Array<{positionId:string;revision:number}>;for(const row of due){const changeId=id("change","resurface",row.positionId,String(row.revision));const decisionId=id("spdec",changeId);this.db.query(`INSERT OR IGNORE INTO changes(id,occurred_at,actor,source,summary,status) VALUES(?,?,'Gig Scout','automation','Resurfaced deferred Scout position','committed')`).run(changeId,now);this.db.query(`INSERT OR IGNORE INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,expected_state_revision,resulting_state_revision,created_at) VALUES(?,?,?,'restore','system','Gig Scout',?,?,?)`).run(decisionId,changeId,row.positionId,row.revision,row.revision+1,now);this.db.query(`UPDATE scout_position_states SET state='needs_user_review',deferred_until=NULL,current_decision_id=?,revision=revision+1,updated_at=? WHERE position_id=? AND revision=?`).run(decisionId,now,row.positionId,row.revision);}return due.length;})();}
}
