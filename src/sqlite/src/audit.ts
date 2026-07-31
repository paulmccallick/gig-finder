import type { Database } from "bun:sqlite";
import type { EntityName } from "../../core/src/models";
import type { AuditQuery } from "../../core/src/services";

const historyTable:Record<EntityName,string>={job:"job_history",person:"person_history",networking:"networking_contact_history","job-person":"job_people_history",task:"task_history",meeting:"meeting_history","meeting-participant":"meeting_participant_history"};

export class AuditReader {
  constructor(private readonly database:Database){}

  query(query:AuditQuery):Record<string,unknown>|Record<string,unknown>[]|null {
    if(query.resource==="change")return this.database.query("SELECT * FROM changes WHERE id = ?").get(query.id) as Record<string,unknown>|null;
    if(query.resource==="history")return this.database.query(`SELECT * FROM ${historyTable[query.entity]} WHERE id = ? ORDER BY revision, history_id`).all(query.id) as Record<string,unknown>[];
    const conditions:string[]=[],bindings:string[]=[];
    if(query.entityType){conditions.push("entity_type = ?");bindings.push(query.entityType);}
    if(query.entityId){conditions.push("entity_id = ?");bindings.push(query.entityId);}
    return this.database.query(`SELECT * FROM business_events${conditions.length?` WHERE ${conditions.join(" AND ")}`:""} ORDER BY occurred_at, id`).all(...bindings) as Record<string,unknown>[];
  }
}
