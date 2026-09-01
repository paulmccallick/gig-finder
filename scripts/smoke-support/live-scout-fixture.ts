import type { Database } from "bun:sqlite";

interface LiveScoutFixture {
  now: string;
  positionId: string;
  description: string;
  descriptionHash: string;
  artifactId: string;
  descriptionId: string;
  profile: unknown;
  profileHash: string;
}

export function seedLiveScoutFixture(database: Database, fixture: LiveScoutFixture) {
  const { now, positionId, description, descriptionHash, artifactId, descriptionId, profile, profileHash } = fixture;
  database.exec(`INSERT INTO scout_companies(id,name,created_at,updated_at) VALUES('smoke-live-company','Synthetic Systems','${now}','${now}');`);
  database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,external_id,canonical_url,title,location,first_seen_at,last_seen_at) VALUES(?,'smoke-live-company','official','external_id','smoke-live-role','smoke-live-role','https://example.invalid/jobs/smoke-live-role','Director of Software Engineering','Remote',?,?)`).run(positionId,now,now);
  database.query(`INSERT INTO scout_position_states(position_id,state,revision,created_at,updated_at) VALUES(?,'processing',1,?,?)`).run(positionId,now,now);
  database.query(`INSERT INTO scout_description_artifacts(id,file_path,content_hash,media_type,byte_count,provenance_json,created_at) VALUES(?,?,?,'text/markdown',?,'{}',?)`).run(artifactId,`${descriptionHash}.md`,descriptionHash,Buffer.byteLength(description),now);
  database.query(`INSERT INTO scout_position_descriptions(id,position_id,artifact_id,source_url,retrieved_at,source_content_hash,markdown_content_hash,converter_version,created_at) VALUES(?,?,?,'https://example.invalid/jobs/smoke-live-role',?,?,?,?,?)`).run(descriptionId,positionId,artifactId,now,descriptionHash,descriptionHash,"html-to-markdown-v1",now);
  database.exec(`
    INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES('smoke-live-config','smoke-live-company',1,'smoke-live-fingerprint','${now}');
    INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json) VALUES('smoke-live-source-config','smoke-live-config','official','json','{}');
    INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at,company_count,search_profile_json,screening_cache_key,candidate_profile_json,candidate_profile_version,candidate_profile_artifact_id,candidate_profile_hash) VALUES('smoke-live-run','completed',1,1,'${now}',1,'{"terms":[],"locations":[]}','smoke-live-run-cache-key','${JSON.stringify(profile).replaceAll("'","''")}','smoke-live-profile-v1','smoke-live-profile-artifact','${profileHash}');
    INSERT INTO scout_run_companies(id,run_id,company_id,company_name,company_configuration_id,status) VALUES('smoke-live-run-company','smoke-live-run','smoke-live-company','Synthetic Systems','smoke-live-config','succeeded');
    INSERT INTO scout_run_sources(id,run_company_id,configuration_source_id,status,candidate_count,accepted_count,rejected_count) VALUES('smoke-live-run-source','smoke-live-run-company','smoke-live-source-config','succeeded_with_results',1,1,0);
    INSERT INTO scout_position_observations(id,run_source_id,position_id,description_artifact_id,title,canonical_url,location,provenance_json,observed_at) VALUES('smoke-live-observation','smoke-live-run-source','${positionId}','${artifactId}','Director of Software Engineering','https://example.invalid/jobs/smoke-live-role','Remote','{}','${now}');
  `);
}
