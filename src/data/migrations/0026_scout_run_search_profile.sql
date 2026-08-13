ALTER TABLE scout_runs ADD COLUMN search_profile_json text NOT NULL DEFAULT '{"terms":[],"locations":[]}';
