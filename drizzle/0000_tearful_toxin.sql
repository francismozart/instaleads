CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_created_idx` ON `ai_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_lead_idx` ON `ai_calls` (`lead_id`);--> statement-breakpoint
CREATE TABLE `daily_counters` (
	`date` text PRIMARY KEY NOT NULL,
	`dm_sent` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `do_not_contact` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`reason` text,
	`source` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `do_not_contact_handle_uq` ON `do_not_contact` (`handle`);--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text,
	`job_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `exceptions_status_idx` ON `exceptions` (`status`);--> statement-breakpoint
CREATE INDEX `exceptions_kind_idx` ON `exceptions` (`kind`);--> statement-breakpoint
CREATE TABLE `experiment_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `experiment_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_assignments_uq` ON `experiment_assignments` (`experiment_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `experiment_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `experiment_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `experiment_outcomes_variant_metric_idx` ON `experiment_outcomes` (`variant_id`,`metric`);--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_outcomes_uq` ON `experiment_outcomes` (`experiment_id`,`lead_id`,`metric`);--> statement-breakpoint
CREATE TABLE `experiment_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`config` text,
	`weight` real DEFAULT 1 NOT NULL,
	`is_control` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_variants_uq` ON `experiment_variants` (`experiment_id`,`key`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`variable` text NOT NULL,
	`funnel` text DEFAULT 'both' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`exploration_rate` real DEFAULT 0.1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_name_uq` ON `experiments` (`name`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`run_after` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`last_error` text,
	`locked_at` text,
	`locked_by` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_uq` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_runafter_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_type_idx` ON `jobs` (`type`);--> statement-breakpoint
CREATE TABLE `lead_events` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lead_events_lead_idx` ON `lead_events` (`lead_id`);--> statement-breakpoint
CREATE INDEX `lead_events_type_idx` ON `lead_events` (`type`);--> statement-breakpoint
CREATE INDEX `lead_events_created_idx` ON `lead_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_handle` text NOT NULL,
	`full_name` text,
	`funnel` text NOT NULL,
	`pipeline_state` text NOT NULL,
	`channel_state` text NOT NULL,
	`channel_owner` text DEFAULT 'none' NOT NULL,
	`actor_type` text DEFAULT 'unknown' NOT NULL,
	`is_decision_maker` integer DEFAULT false NOT NULL,
	`niche` text,
	`category` text,
	`score` real DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`source` text,
	`keyword` text,
	`profile` text,
	`meta_user_id` text,
	`last_contacted_at` text,
	`next_action_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_handle_uq` ON `leads` (`handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_meta_user_uq` ON `leads` (`meta_user_id`);--> statement-breakpoint
CREATE INDEX `leads_funnel_pipeline_idx` ON `leads` (`funnel`,`pipeline_state`);--> statement-breakpoint
CREATE INDEX `leads_next_action_idx` ON `leads` (`next_action_at`);--> statement-breakpoint
CREATE INDEX `leads_channel_state_idx` ON `leads` (`channel_state`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`variant_id` text,
	`intent` text,
	`status` text NOT NULL,
	`external_id` text,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_dedupe_uq` ON `messages` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_external_uq` ON `messages` (`external_id`);--> statement-breakpoint
CREATE INDEX `messages_lead_idx` ON `messages` (`lead_id`);--> statement-breakpoint
CREATE INDEX `messages_channel_idx` ON `messages` (`channel`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_event_id` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'received' NOT NULL,
	`processed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_external_uq` ON `webhook_events` (`external_event_id`);