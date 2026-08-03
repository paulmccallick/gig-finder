import { GigFinderApplication } from "../../core/src/application";
import { AuditReader } from "./audit";
import { LocalArtifactStore } from "./artifacts";
import { openDatabase } from "./database";
import { DataStore } from "./store";
import {
  defaultAgentModelId,
  type AgentModelId,
} from "../../core/src/application-settings";

export interface LocalApplicationPaths { database: string; artifacts: string }
export interface LocalApplicationOptions { defaultAgentModel?: AgentModelId }
export function openLocalApplication(paths:LocalApplicationPaths,options:LocalApplicationOptions={}){
  const database=openDatabase(paths.database,{create:false});
  return {application:new GigFinderApplication(new DataStore(database),new AuditReader(database),new LocalArtifactStore(paths.artifacts),options.defaultAgentModel??defaultAgentModelId),close:()=>database.close()};
}
