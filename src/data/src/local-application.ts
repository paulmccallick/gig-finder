import { GigFinderApplication } from "../../core/src/application";
import { AuditReader } from "./audit";
import { LocalArtifactStore } from "./artifacts";
import { openDatabase } from "./database";
import { DataStore } from "./store";
import {
  defaultAgentModelId,
  type AgentModelId,
} from "../../core/src/application-settings";
import { LocalProfileDocumentFiles } from "./profile-document-files";
import { validateDatabase } from "./maintenance";

export interface LocalApplicationPaths { database: string; artifacts: string; profileDocuments?: string }
export interface LocalApplicationOptions {
  defaultAgentModel?: AgentModelId;
  onProfileDocumentMaterializationFailure?: (
    error: unknown,
    document: { id: string; currentVersion: number },
  ) => void;
}
export function openLocalApplication(paths:LocalApplicationPaths,options:LocalApplicationOptions={}){
  const database=openDatabase(paths.database,{create:false});
  const store=new DataStore(
    database,
    paths.profileDocuments?new LocalProfileDocumentFiles(paths.profileDocuments):undefined,
    options.onProfileDocumentMaterializationFailure,
  );
  store.synchronizeProfileDocuments();
  return {
    application:new GigFinderApplication(store,new AuditReader(database),new LocalArtifactStore(paths.artifacts),options.defaultAgentModel??defaultAgentModelId),
    validate:()=>validateDatabase(database),
    close:()=>database.close(),
  };
}
