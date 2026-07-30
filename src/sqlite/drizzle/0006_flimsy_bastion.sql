CREATE TABLE `managed_document_versions` (
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`parent_version` integer,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`change_id` text NOT NULL,
	`change_summary` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`document_id`, `version`),
	FOREIGN KEY (`document_id`) REFERENCES `managed_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_document_versions_version_check" CHECK("managed_document_versions"."version" > 0),
	CONSTRAINT "managed_document_versions_parent_check" CHECK("managed_document_versions"."parent_version" is null or "managed_document_versions"."parent_version" < "managed_document_versions"."version")
);
--> statement-breakpoint
CREATE INDEX `managed_document_versions_change_idx` ON `managed_document_versions` (`change_id`);--> statement-breakpoint
CREATE TABLE `managed_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`document_type` text NOT NULL,
	`title` text NOT NULL,
	`media_type` text NOT NULL,
	`source_description` text,
	`current_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_documents_owner_type_check" CHECK("managed_documents"."owner_type" = 'job'),
	CONSTRAINT "managed_documents_type_check" CHECK("managed_documents"."document_type" in ('job_description', 'notes', 'interview_prep')),
	CONSTRAINT "managed_documents_media_type_check" CHECK("managed_documents"."media_type" in ('text/plain', 'text/markdown')),
	CONSTRAINT "managed_documents_current_version_check" CHECK("managed_documents"."current_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `managed_documents_owner_idx` ON `managed_documents` (`owner_type`,`owner_id`);