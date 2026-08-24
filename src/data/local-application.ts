import { GigFinderApplication } from "../core/application";
import { AuditReader } from "./audit";
import { LocalArtifactStore } from "./artifacts";
import { openDatabase } from "./database";
import { DataStore } from "./store";
import {
  defaultAgentModelId,
  type AgentModelId,
} from "../core/application-settings";
import { LocalProfileDocumentFiles } from "./profile-document-files";
import { validateDatabase } from "./maintenance";
import { SqliteConversationRepository } from "./conversation-store";
import { SqliteScoutRunStore } from "./scout-run-store";
import { ScoutRunService } from "../core/scout/engine/runs";
import { ScoutPositionService } from "../core/scout/engine/scout-position-service";
import { SqliteScoutCompanyImportStore } from "./scout-company-import-store";
import type { ScoutScreeningInputs } from "./scout-run-store";
import type { TemplateResolver } from "../core/scout/sourcing/adapters/templates/definitions";

export interface LocalApplicationPaths { database: string; artifacts: string; profileDocuments?: string; scoutDescriptions?:string }
export interface LocalApplicationOptions {
  defaultAgentModel?: AgentModelId;
  onProfileDocumentMaterializationFailure?: (
    error: unknown,
    document: { id: string; currentVersion: number },
  ) => void;
  scoutDefaults?: { batchSize:number; concurrency:number };
  scoutScreening?:ScoutScreeningInputs;
  scoutTemplates?:TemplateResolver;
}
export function openLocalApplication(paths:LocalApplicationPaths,options:LocalApplicationOptions={}){
  const database=openDatabase(paths.database,{create:false});
  const store=new DataStore(
    database,
    paths.profileDocuments?new LocalProfileDocumentFiles(paths.profileDocuments):undefined,
    options.onProfileDocumentMaterializationFailure,
  );
  store.synchronizeProfileDocuments();
  const application=new GigFinderApplication(store,new AuditReader(database),new LocalArtifactStore(paths.artifacts),options.defaultAgentModel??defaultAgentModelId);
  const scoutStore=new SqliteScoutRunStore(database,paths.scoutDescriptions,options.scoutScreening,undefined,options.scoutTemplates);
  return {
    application,
    conversations:new SqliteConversationRepository(database),
    scout:new ScoutRunService(scoutStore,options.scoutDefaults),
    scoutPositions:new ScoutPositionService(scoutStore,application.gigs,application.documents),
    scoutStore,
    scoutCompanyImportStore:new SqliteScoutCompanyImportStore(database),
    validate:()=>validateDatabase(database),
    close:()=>database.close(),
  };
}
