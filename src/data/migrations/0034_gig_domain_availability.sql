ALTER TABLE gigs RENAME COLUMN scout_availability TO availability;
--> statement-breakpoint
ALTER TABLE gigs RENAME COLUMN scout_availability_updated_at TO availability_updated_at;
--> statement-breakpoint
ALTER TABLE gig_history RENAME COLUMN scout_availability TO availability;
--> statement-breakpoint
ALTER TABLE gig_history RENAME COLUMN scout_availability_updated_at TO availability_updated_at;
--> statement-breakpoint
DROP TABLE scout_gig_availability_history;
