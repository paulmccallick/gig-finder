ALTER TABLE scout_position_states ADD COLUMN current_decision_id text REFERENCES scout_position_decisions(id);
--> statement-breakpoint
ALTER TABLE scout_position_state_history ADD COLUMN current_decision_id text;
--> statement-breakpoint
CREATE TABLE scout_position_decisions (
 id text PRIMARY KEY,
 change_id text NOT NULL UNIQUE REFERENCES changes(id),
 position_id text NOT NULL REFERENCES scout_positions(id),
 action text NOT NULL CHECK(action IN ('irrelevant','defer','restore','pursue','reverse')),
 origin text NOT NULL CHECK(origin IN ('agent','user','system')),
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 255),
 reason text CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 500),
 note text CHECK(note IS NULL OR length(note) BETWEEN 1 AND 2000),
 description_id text REFERENCES scout_position_descriptions(id),
 relevance_evaluation_id text REFERENCES scout_relevance_evaluations(id),
 candidate_match_evaluation_id text REFERENCES scout_candidate_match_evaluations(id),
 expected_state_revision integer NOT NULL CHECK(expected_state_revision > 0),
 resulting_state_revision integer NOT NULL CHECK(resulting_state_revision > expected_state_revision),
 review_at text,
 reverses_decision_id text REFERENCES scout_position_decisions(id),
 created_at text NOT NULL,
 CHECK(origin<>'agent' OR action<>'irrelevant' OR (reason IS NOT NULL AND relevance_evaluation_id IS NOT NULL)),
 CHECK(origin<>'user' OR action NOT IN ('irrelevant','defer','pursue') OR (description_id IS NOT NULL AND relevance_evaluation_id IS NOT NULL AND candidate_match_evaluation_id IS NOT NULL)),
 CHECK(action='defer' OR review_at IS NULL),
 CHECK(action<>'defer' OR review_at IS NOT NULL),
 CHECK(action='reverse' OR reverses_decision_id IS NULL),
 CHECK(action<>'reverse' OR reverses_decision_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX scout_position_decisions_position_idx ON scout_position_decisions(position_id,created_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX scout_position_decisions_one_reversal_idx ON scout_position_decisions(reverses_decision_id) WHERE reverses_decision_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER scout_position_reversal_active BEFORE INSERT ON scout_position_decisions
WHEN NEW.action='reverse' AND NOT EXISTS(SELECT 1 FROM scout_position_states s WHERE s.position_id=NEW.position_id AND s.current_decision_id=NEW.reverses_decision_id)
BEGIN SELECT RAISE(ABORT,'Only the active Scout position decision may be reversed.'); END;
--> statement-breakpoint
CREATE TABLE scout_position_notes (
 id text PRIMARY KEY,
 position_id text NOT NULL REFERENCES scout_positions(id),
 decision_id text REFERENCES scout_position_decisions(id),
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 255),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX scout_position_notes_position_idx ON scout_position_notes(position_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER scout_position_note_decision_match BEFORE INSERT ON scout_position_notes
WHEN NEW.decision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scout_position_decisions d WHERE d.id=NEW.decision_id AND d.position_id=NEW.position_id)
BEGIN SELECT RAISE(ABORT,'Scout position note decision does not belong to the position.'); END;
--> statement-breakpoint
CREATE TABLE scout_position_promotions (
 id text PRIMARY KEY,
 decision_id text NOT NULL UNIQUE REFERENCES scout_position_decisions(id),
 position_id text NOT NULL UNIQUE REFERENCES scout_positions(id),
 description_id text NOT NULL REFERENCES scout_position_descriptions(id),
 gig_id text REFERENCES gigs(id),
 managed_document_id text REFERENCES managed_documents(id),
 status text NOT NULL CHECK(status IN ('pending','completed','failed')),
 failure_code text CHECK(failure_code IS NULL OR length(failure_code)<=100),
 failure_message text CHECK(failure_message IS NULL OR length(failure_message)<=500),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 created_at text NOT NULL,
 updated_at text NOT NULL,
 completed_at text,
 CHECK(status<>'completed' OR (gig_id IS NOT NULL AND managed_document_id IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO changes(id,occurred_at,actor,source,summary,status)
SELECT 'change_scout_agent_irrelevant_'||s.position_id,datetime('now'),'Gig Scout','migration','Attributed existing agent Scout irrelevance','committed'
FROM scout_position_states s
WHERE s.state='irrelevant' AND EXISTS(SELECT 1 FROM scout_relevance_evaluations r WHERE r.position_id=s.position_id);
--> statement-breakpoint
INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,reason,description_id,relevance_evaluation_id,expected_state_revision,resulting_state_revision,created_at)
SELECT 'spdec_agent_irrelevant_'||s.position_id,'change_scout_agent_irrelevant_'||s.position_id,s.position_id,'irrelevant','agent','Gig Scout',r.reason,r.description_id,r.id,s.revision,s.revision+1,datetime('now')
FROM scout_position_states s
JOIN scout_relevance_evaluations r ON r.id=(SELECT latest.id FROM scout_relevance_evaluations latest WHERE latest.position_id=s.position_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
WHERE s.state='irrelevant';
--> statement-breakpoint
UPDATE scout_position_states SET current_decision_id='spdec_agent_irrelevant_'||position_id,revision=revision+1,updated_at=datetime('now')
WHERE state='irrelevant' AND EXISTS(SELECT 1 FROM scout_position_decisions d WHERE d.position_id=scout_position_states.position_id);
--> statement-breakpoint
CREATE TRIGGER scout_agent_irrelevant_decision AFTER UPDATE OF state ON scout_position_states
WHEN NEW.state='irrelevant' AND OLD.state<>'irrelevant' AND NEW.current_decision_id IS NULL
BEGIN
 INSERT OR IGNORE INTO changes(id,occurred_at,actor,source,summary,status) VALUES('change_scout_agent_irrelevant_'||NEW.position_id||'_'||NEW.revision,NEW.updated_at,'Gig Scout','automation','Agent marked Scout position irrelevant','committed');
 INSERT OR IGNORE INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,reason,description_id,relevance_evaluation_id,expected_state_revision,resulting_state_revision,created_at)
 SELECT 'spdec_agent_irrelevant_'||NEW.position_id||'_'||NEW.revision,'change_scout_agent_irrelevant_'||NEW.position_id||'_'||NEW.revision,NEW.position_id,'irrelevant','agent','Gig Scout',r.reason,r.description_id,r.id,OLD.revision,NEW.revision,NEW.updated_at
 FROM scout_relevance_evaluations r WHERE r.position_id=NEW.position_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
 UPDATE scout_position_states SET current_decision_id='spdec_agent_irrelevant_'||NEW.position_id||'_'||NEW.revision WHERE position_id=NEW.position_id;
END;
--> statement-breakpoint
CREATE TRIGGER scout_preserve_explicit_user_decision AFTER UPDATE OF state ON scout_position_states
WHEN OLD.current_decision_id IS NOT NULL
 AND NEW.current_decision_id=OLD.current_decision_id
 AND NEW.state<>OLD.state
 AND NEW.state<>'promoted'
 AND EXISTS(SELECT 1 FROM scout_position_decisions d WHERE d.id=OLD.current_decision_id AND d.origin='user' AND d.action IN ('irrelevant','defer','pursue'))
BEGIN
 UPDATE scout_position_states SET state=OLD.state,linked_gig_id=OLD.linked_gig_id,deferred_until=OLD.deferred_until,current_decision_id=OLD.current_decision_id WHERE position_id=OLD.position_id;
END;
