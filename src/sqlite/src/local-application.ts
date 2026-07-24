import { JobSearchApplication } from "../../core/src/application";
import { AuditReader } from "./audit";
import { LocalArtifactStore } from "./artifacts";
import { openDatabase } from "./database";
import { DataStore } from "./store";

export interface LocalApplicationPaths { database: string; artifacts: string }
export function openLocalApplication(paths:LocalApplicationPaths){
  const database=openDatabase(paths.database,{create:false});
  return {application:new JobSearchApplication(new DataStore(database),new AuditReader(database),new LocalArtifactStore(paths.artifacts)),close:()=>database.close()};
}
