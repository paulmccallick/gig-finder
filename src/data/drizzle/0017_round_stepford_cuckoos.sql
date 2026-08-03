PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_managed_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text NOT NULL,
	`title` text,
	`description` text,
	`media_type` text NOT NULL,
	`source_description` text,
	`file_path` text,
	`materialized_version` integer,
	`upload_provenance_json` text,
	`current_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "managed_documents_type_check" CHECK("document_type" in ('job_description', 'notes', 'interview_prep', 'profile')),
	CONSTRAINT "managed_documents_media_type_check" CHECK("media_type" in ('text/plain', 'text/markdown')),
	CONSTRAINT "managed_documents_current_version_check" CHECK("current_version" > 0),
	CONSTRAINT "managed_documents_description_check" CHECK("description" is null or length("description") <= 255),
	CONSTRAINT "managed_documents_file_path_check" CHECK("file_path" is null or (instr("file_path", '/') = 0 and instr("file_path", '\') = 0 and "file_path" like '%.md')),
	CONSTRAINT "managed_documents_materialized_version_check" CHECK("materialized_version" is null or ("materialized_version" > 0 and "materialized_version" <= "current_version"))
);
--> statement-breakpoint
INSERT INTO `__new_managed_documents`("id", "document_type", "title", "description", "media_type", "source_description", "file_path", "materialized_version", "upload_provenance_json", "current_version", "created_at", "updated_at") SELECT "id", "document_type", "title", "description", "media_type", "source_description", "file_path", NULL, "upload_provenance_json", "current_version", "created_at", "updated_at" FROM `managed_documents`;--> statement-breakpoint
DROP TABLE `managed_documents`;--> statement-breakpoint
ALTER TABLE `__new_managed_documents` RENAME TO `managed_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `managed_documents_file_path_unique` ON `managed_documents` (`file_path`);
