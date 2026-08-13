PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE scout_company_configuration_sources_replacement (id text PRIMARY KEY, company_configuration_id text NOT NULL REFERENCES scout_company_configurations(id), source_key text NOT NULL, source_type text NOT NULL CHECK(source_type IN ('json','html')), settings_json text NOT NULL CHECK(json_valid(settings_json)), active integer NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(company_configuration_id, source_key));--> statement-breakpoint
INSERT INTO scout_company_configuration_sources_replacement SELECT id, company_configuration_id, source_key, source_type, settings_json, active FROM scout_company_configuration_sources;--> statement-breakpoint
DROP TABLE scout_company_configuration_sources;--> statement-breakpoint
ALTER TABLE scout_company_configuration_sources_replacement RENAME TO scout_company_configuration_sources;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN source_reported_total integer CHECK(source_reported_total IS NULL OR source_reported_total >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN records_received integer NOT NULL DEFAULT 0 CHECK(records_received >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN records_parsed integer NOT NULL DEFAULT 0 CHECK(records_parsed >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN records_evaluable integer NOT NULL DEFAULT 0 CHECK(records_evaluable >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN records_evaluated integer NOT NULL DEFAULT 0 CHECK(records_evaluated >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN pages_requested integer NOT NULL DEFAULT 0 CHECK(pages_requested >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN pages_validated integer NOT NULL DEFAULT 0 CHECK(pages_validated >= 0);--> statement-breakpoint
ALTER TABLE scout_source_attempts ADD COLUMN unique_identities integer NOT NULL DEFAULT 0 CHECK(unique_identities >= 0);
