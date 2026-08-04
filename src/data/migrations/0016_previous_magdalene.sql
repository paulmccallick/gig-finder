CREATE TABLE `candidate_profiles` (
	`id` text PRIMARY KEY NOT NULL
);--> statement-breakpoint
INSERT INTO `candidate_profiles` (`id`) VALUES ('candidate');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_managed_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text NOT NULL,
	`title` text,
	`description` text,
	`media_type` text NOT NULL,
	`source_description` text,
	`file_path` text,
	`upload_provenance_json` text,
	`current_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "managed_documents_type_check" CHECK("document_type" in ('job_description', 'notes', 'interview_prep', 'profile')),
	CONSTRAINT "managed_documents_media_type_check" CHECK("media_type" in ('text/plain', 'text/markdown')),
	CONSTRAINT "managed_documents_current_version_check" CHECK("current_version" > 0),
	CONSTRAINT "managed_documents_description_check" CHECK("description" is null or length("description") <= 255),
	CONSTRAINT "managed_documents_file_path_check" CHECK("file_path" is null or (instr("file_path", '/') = 0 and instr("file_path", '\') = 0 and "file_path" like '%.md'))
);--> statement-breakpoint
INSERT INTO `__new_managed_documents`("id", "document_type", "title", "description", "media_type", "source_description", "file_path", "upload_provenance_json", "current_version", "created_at", "updated_at")
SELECT "id", "document_type", "title", NULL, "media_type", "source_description", NULL, "upload_provenance_json", "current_version", "created_at", "updated_at" FROM `managed_documents`;--> statement-breakpoint
DROP TABLE `managed_documents`;--> statement-breakpoint
ALTER TABLE `__new_managed_documents` RENAME TO `managed_documents`;--> statement-breakpoint
CREATE UNIQUE INDEX `managed_documents_file_path_unique` ON `managed_documents` (`file_path`);--> statement-breakpoint
CREATE TABLE `__new_managed_document_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`gig_id` text,
	`person_id` text,
	`profile_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `managed_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_document_links_target_check" CHECK(("gig_id" is not null and "person_id" is null and "profile_id" is null) or ("gig_id" is null and "person_id" is not null and "profile_id" is null) or ("gig_id" is null and "person_id" is null and "profile_id" is not null))
);--> statement-breakpoint
INSERT INTO `__new_managed_document_links`("id", "document_id", "gig_id", "person_id", "profile_id")
SELECT "id", "document_id", "gig_id", "person_id", NULL FROM `managed_document_links`;--> statement-breakpoint
DROP TABLE `managed_document_links`;--> statement-breakpoint
ALTER TABLE `__new_managed_document_links` RENAME TO `managed_document_links`;--> statement-breakpoint
CREATE INDEX `managed_document_links_document_idx` ON `managed_document_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_gig_idx` ON `managed_document_links` (`gig_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_person_idx` ON `managed_document_links` (`person_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_profile_idx` ON `managed_document_links` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_gig_unique` ON `managed_document_links` (`document_id`,`gig_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_person_unique` ON `managed_document_links` (`document_id`,`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_profile_unique` ON `managed_document_links` (`document_id`,`profile_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
