import type { Database } from "bun:sqlite";
import type { ScoutCompanyImportStore } from "../core/scout-company-import";
import type { SourceConfiguration } from "../gig-scout";
import { createHash } from "node:crypto";

const sourceId = (configurationId: string, key: string) => `ssrc_${createHash("sha256").update(`${configurationId}\0${key}`).digest("hex").slice(0,32)}`;
export class SqliteScoutCompanyImportStore implements ScoutCompanyImportStore {
  constructor(private readonly database: Database) {}
  transaction<T>(operation: () => T): T { return this.database.transaction(operation)(); }
  current(companyId: string) { return this.database.query(`SELECT c.fingerprint, c.version FROM scout_companies s JOIN scout_company_configurations c ON c.id=s.current_configuration_id WHERE s.id=?`).get(companyId) as {fingerprint:string;version:number}|null; }
  private sources(configurationId: string, sources: SourceConfiguration[]) { const insert=this.database.query(`INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json,active) VALUES(?,?,?,?,?,?)`); for(const source of sources) insert.run(sourceId(configurationId,source.key),configurationId,source.key,source.type,JSON.stringify(source),source.active?1:0); }
  createCompany(input: { id:string;name:string;active:boolean;configurationId:string;fingerprint:string;sources:SourceConfiguration[];at:string }) { this.database.query(`INSERT INTO scout_companies(id,name,active,current_configuration_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(input.id,input.name,input.active?1:0,input.configurationId,input.at,input.at); this.database.query(`INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES(?,?,?,?,?)`).run(input.configurationId,input.id,1,input.fingerprint,input.at); this.sources(input.configurationId,input.sources); }
  versionCompany(input: { id:string;name:string;active:boolean;configurationId:string;version:number;fingerprint:string;sources:SourceConfiguration[];at:string }) { this.database.query(`INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES(?,?,?,?,?)`).run(input.configurationId,input.id,input.version,input.fingerprint,input.at); this.sources(input.configurationId,input.sources); this.database.query(`UPDATE scout_companies SET name=?,active=?,current_configuration_id=?,updated_at=? WHERE id=?`).run(input.name,input.active?1:0,input.configurationId,input.at,input.id); }
}
