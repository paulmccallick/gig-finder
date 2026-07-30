PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TEMP TABLE `__managed_document_owners` (
	`document_id` text NOT NULL,
	`job_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__managed_document_owners` (`document_id`, `job_id`)
SELECT `id`, `owner_id` FROM `managed_documents`;--> statement-breakpoint
CREATE TABLE `__new_managed_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text NOT NULL,
	`title` text,
	`media_type` text NOT NULL,
	`source_description` text,
	`upload_provenance_json` text,
	`current_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "managed_documents_type_check" CHECK("document_type" in ('job_description', 'notes', 'interview_prep', 'profile')),
	CONSTRAINT "managed_documents_media_type_check" CHECK("media_type" in ('text/plain', 'text/markdown')),
	CONSTRAINT "managed_documents_current_version_check" CHECK("current_version" > 0)
);--> statement-breakpoint
INSERT INTO `__new_managed_documents`("id", "document_type", "title", "media_type", "source_description", "upload_provenance_json", "current_version", "created_at", "updated_at") SELECT "id", "document_type", "title", "media_type", "source_description", "upload_provenance_json", "current_version", "created_at", "updated_at" FROM `managed_documents`;--> statement-breakpoint
DROP TABLE `managed_documents`;--> statement-breakpoint
ALTER TABLE `__new_managed_documents` RENAME TO `managed_documents`;--> statement-breakpoint
CREATE TABLE `managed_document_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`job_id` text,
	`person_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `managed_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_document_links_target_check" CHECK(("managed_document_links"."job_id" is not null and "managed_document_links"."person_id" is null) or ("managed_document_links"."job_id" is null and "managed_document_links"."person_id" is not null))
);--> statement-breakpoint
CREATE INDEX `managed_document_links_document_idx` ON `managed_document_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_job_idx` ON `managed_document_links` (`job_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_person_idx` ON `managed_document_links` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_job_unique` ON `managed_document_links` (`document_id`,`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_person_unique` ON `managed_document_links` (`document_id`,`person_id`);--> statement-breakpoint
INSERT INTO `managed_document_links` (`document_id`, `job_id`, `person_id`)
SELECT `document_id`, `job_id`, NULL FROM `__managed_document_owners`;--> statement-breakpoint
DROP TABLE `__managed_document_owners`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
