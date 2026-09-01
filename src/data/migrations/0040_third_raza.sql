PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scout_run_companies` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`company_id` text NOT NULL,
	`company_name` text NOT NULL,
	`company_configuration_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`failure_code` text,
	`failure_message` text,
	FOREIGN KEY (`run_id`) REFERENCES `scout_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `scout_companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_configuration_id`) REFERENCES `scout_company_configurations`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_scout_run_companies`(
	`id`,
	`run_id`,
	`company_id`,
	`company_name`,
	`company_configuration_id`,
	`status`,
	`started_at`,
	`completed_at`,
	`failure_code`,
	`failure_message`
)
SELECT
	run_company.`id`,
	run_company.`run_id`,
	run_company.`company_id`,
	company.`name`,
	run_company.`company_configuration_id`,
	run_company.`status`,
	run_company.`started_at`,
	run_company.`completed_at`,
	run_company.`failure_code`,
	run_company.`failure_message`
FROM `scout_run_companies` run_company
JOIN `scout_companies` company ON company.`id` = run_company.`company_id`;--> statement-breakpoint
DROP TABLE `scout_run_companies`;--> statement-breakpoint
ALTER TABLE `__new_scout_run_companies` RENAME TO `scout_run_companies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
