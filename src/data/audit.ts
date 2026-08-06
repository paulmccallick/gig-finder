import type { Database } from "bun:sqlite";
import type { EntityName } from "../core/models";
import type { AuditQuery } from "../core/services";

const historyTable:Record<EntityName,string>={gig:"gig_history",person:"person_history","gig-person":"gig_people_history",task:"task_history",interaction:"interaction_history","interaction-participant":"interaction_participant_history"};

export class AuditReader {
  constructor(private readonly database:Database){}

  query(query:AuditQuery):Record<string,unknown>|Record<string,unknown>[]|null {
    if(query.resource==="change")return this.database.query("SELECT * FROM changes WHERE id = ?").get(query.id) as Record<string,unknown>|null;
    return this.database.query(`SELECT * FROM ${historyTable[query.entity]} WHERE id = ? ORDER BY revision, history_id`).all(query.id) as Record<string,unknown>[];
  }
}
