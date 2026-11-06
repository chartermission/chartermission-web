CREATE TABLE "course_topic_links" (
	"course_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_topic_links_course_id_topic_id_pk" PRIMARY KEY("course_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "course_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'beginner' NOT NULL,
	"duration_minutes" integer,
	"lessons" integer,
	"language" text DEFAULT 'en' NOT NULL,
	"free" boolean DEFAULT true NOT NULL,
	"eligibility" text,
	"access_conditions" text,
	"outcomes" text[] DEFAULT '{}'::text[] NOT NULL,
	"start_url" text NOT NULL,
	"thumbnail_url" text,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"featured_at" timestamp with time zone,
	"link_status" text DEFAULT 'unknown' NOT NULL,
	"link_http_status" integer,
	"link_checked_at" timestamp with time zone,
	"link_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "courses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "courses_level_ck" CHECK ("courses"."level" in ('beginner','intermediate','advanced')),
	CONSTRAINT "courses_link_status_ck" CHECK ("courses"."link_status" in ('ok','broken','unknown'))
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"position" integer,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"attended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_status_ck" CHECK ("event_registrations"."status" in ('registered','waitlisted','cancelled','attended')),
	CONSTRAINT "event_registrations_waitlist_ck" CHECK ("event_registrations"."status" <> 'waitlisted' or "event_registrations"."position" is not null)
);
--> statement-breakpoint
CREATE TABLE "event_reminders_sent" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"offset_minutes" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reminders_sent_event_id_user_id_offset_minutes_pk" PRIMARY KEY("event_id","user_id","offset_minutes"),
	CONSTRAINT "event_reminders_offset_ck" CHECK ("event_reminders_sent"."offset_minutes" in (1440, 60))
);
--> statement-breakpoint
CREATE TABLE "event_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"organisation" text,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"format" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"host_type" text NOT NULL,
	"host_member_id" uuid,
	"host_chapter_id" uuid,
	"host_organisation_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"venue_name" text,
	"venue_address" text,
	"venue_city" text,
	"venue_map_url" text,
	"country_code" text,
	"online_platform" text,
	"online_url_enc" text,
	"registration_mode" text DEFAULT 'internal' NOT NULL,
	"external_url" text,
	"capacity" integer,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"registration_deadline" timestamp with time zone,
	"registered_count" integer DEFAULT 0 NOT NULL,
	"waitlist_count" integer DEFAULT 0 NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cover_file_id" uuid,
	"featured" boolean DEFAULT false NOT NULL,
	"featured_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submit_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_note" text,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_format_ck" CHECK ("events"."format" in ('online','in_person','hybrid')),
	CONSTRAINT "events_status_ck" CHECK ("events"."status" in ('draft','pending_review','changes_requested','published','rejected','unpublished','archived')),
	CONSTRAINT "events_host_type_ck" CHECK ("events"."host_type" in ('member','chapter','organisation')),
	CONSTRAINT "events_host_ck" CHECK (("events"."host_type" = 'member' and "events"."host_member_id" is not null and "events"."host_chapter_id" is null and "events"."host_organisation_id" is null)
        or ("events"."host_type" = 'chapter' and "events"."host_chapter_id" is not null and "events"."host_member_id" is null and "events"."host_organisation_id" is null)
        or ("events"."host_type" = 'organisation' and "events"."host_organisation_id" is not null and "events"."host_member_id" is null and "events"."host_chapter_id" is null)),
	CONSTRAINT "events_time_ck" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_deadline_ck" CHECK ("events"."registration_deadline" is null or "events"."registration_deadline" <= "events"."starts_at"),
	CONSTRAINT "events_reg_mode_ck" CHECK ("events"."registration_mode" in ('internal','external')),
	CONSTRAINT "events_capacity_ck" CHECK ("events"."capacity" is null or "events"."capacity" >= 1),
	CONSTRAINT "events_external_ck" CHECK ("events"."registration_mode" = 'internal' or ("events"."capacity" is null and "events"."external_url" is not null)),
	CONSTRAINT "events_counts_ck" CHECK ("events"."registered_count" >= 0 and "events"."waitlist_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_path_courses" (
	"path_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_path_courses_path_id_course_id_pk" PRIMARY KEY("path_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "learning_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"level" text,
	"source_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_paths_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "learning_paths_slug_unique" UNIQUE("slug"),
	CONSTRAINT "learning_paths_level_ck" CHECK ("learning_paths"."level" is null or "learning_paths"."level" in ('beginner','intermediate','advanced'))
);
--> statement-breakpoint
CREATE TABLE "learning_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'sync' NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"checked_count" integer DEFAULT 0 NOT NULL,
	"broken_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_sync_runs_kind_ck" CHECK ("learning_sync_runs"."kind" in ('sync','link_check')),
	CONSTRAINT "learning_sync_runs_trigger_ck" CHECK ("learning_sync_runs"."trigger" in ('schedule','admin')),
	CONSTRAINT "learning_sync_runs_status_ck" CHECK ("learning_sync_runs"."status" in ('running','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "subject_id" text;--> statement-breakpoint
ALTER TABLE "course_topic_links" ADD CONSTRAINT "course_topic_links_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_topic_links" ADD CONSTRAINT "course_topic_links_topic_id_course_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."course_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reminders_sent" ADD CONSTRAINT "event_reminders_sent_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reminders_sent" ADD CONSTRAINT "event_reminders_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_member_id_users_id_fk" FOREIGN KEY ("host_member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_chapter_id_chapters_id_fk" FOREIGN KEY ("host_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sync_runs" ADD CONSTRAINT "learning_sync_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_topic_links_topic_idx" ON "course_topic_links" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "courses_visible_idx" ON "courses" USING btree ("featured","source_updated_at") WHERE "courses"."hidden" = false and "courses"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "courses_language_idx" ON "courses" USING btree ("language");--> statement-breakpoint
CREATE INDEX "courses_level_idx" ON "courses" USING btree ("level");--> statement-breakpoint
CREATE INDEX "courses_link_idx" ON "courses" USING btree ("link_status");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_uq" ON "event_registrations" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_position_uq" ON "event_registrations" USING btree ("event_id","position") WHERE "event_registrations"."position" is not null;--> statement-breakpoint
CREATE INDEX "event_registrations_event_status_idx" ON "event_registrations" USING btree ("event_id","status","position");--> statement-breakpoint
CREATE INDEX "event_registrations_user_idx" ON "event_registrations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "event_speakers_event_idx" ON "event_speakers" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "event_speakers_member_idx" ON "event_speakers" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "events_status_ends_idx" ON "events" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "events_chapter_idx" ON "events" USING btree ("host_chapter_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_host_member_idx" ON "events" USING btree ("host_member_id");--> statement-breakpoint
CREATE INDEX "events_country_idx" ON "events" USING btree ("country_code","starts_at");--> statement-breakpoint
CREATE INDEX "events_category_idx" ON "events" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "events_created_by_idx" ON "events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "events_queue_idx" ON "events" USING btree ("submitted_at") WHERE "events"."status" = 'pending_review';--> statement-breakpoint
CREATE INDEX "learning_path_courses_order_idx" ON "learning_path_courses" USING btree ("path_id","position");--> statement-breakpoint
CREATE INDEX "learning_path_courses_course_idx" ON "learning_path_courses" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "learning_sync_runs_started_idx" ON "learning_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_sync_runs_running_uq" ON "learning_sync_runs" USING btree ("kind") WHERE "learning_sync_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "analytics_subject_idx" ON "analytics_events" USING btree ("name","subject_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','post_image','post_document','event_cover'));