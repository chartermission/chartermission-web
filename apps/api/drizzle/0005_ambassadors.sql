CREATE TABLE "ambassador_lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ambassador_lead_activities_kind_ck" CHECK ("ambassador_lead_activities"."kind" in ('created','updated','stage','note','scores','onboarding','training','invite','certified'))
);
--> statement-breakpoint
CREATE TABLE "ambassador_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"country_code" text NOT NULL,
	"city" text,
	"organisation" text,
	"job_title" text,
	"linkedin_url" text,
	"source" text DEFAULT 'outreach' NOT NULL,
	"referred_by" text,
	"hours_per_week" integer,
	"motivation" text,
	"notes" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score_total" integer,
	"owner_id" uuid,
	"user_id" uuid,
	"onboarding_started_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"certified_at" timestamp with time zone,
	"founding" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ambassador_leads_stage_ck" CHECK ("ambassador_leads"."stage" in ('new','screening','review','interview','references','decision','onboarding','ambassador','talent_pool','declined','withdrawn')),
	CONSTRAINT "ambassador_leads_source_ck" CHECK ("ambassador_leads"."source" in ('application','nomination','referral','outreach','event','other'))
);
--> statement-breakpoint
CREATE TABLE "ambassador_onboarding_steps" (
	"lead_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ambassador_onboarding_steps_lead_id_step_pk" PRIMARY KEY("lead_id","step"),
	CONSTRAINT "ambassador_onboarding_steps_step_ck" CHECK ("ambassador_onboarding_steps"."step" in ('agreement','account','profile','training','orientation','first_event')),
	CONSTRAINT "ambassador_onboarding_steps_status_ck" CHECK ("ambassador_onboarding_steps"."status" in ('pending','done','waived'))
);
--> statement-breakpoint
CREATE TABLE "ambassador_training_progress" (
	"lead_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ambassador_training_progress_lead_id_course_id_pk" PRIMARY KEY("lead_id","course_id")
);
--> statement-breakpoint
ALTER TABLE "ambassador_lead_activities" ADD CONSTRAINT "ambassador_lead_activities_lead_id_ambassador_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ambassador_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_lead_activities" ADD CONSTRAINT "ambassador_lead_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD CONSTRAINT "ambassador_leads_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD CONSTRAINT "ambassador_leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD CONSTRAINT "ambassador_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD CONSTRAINT "ambassador_leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_onboarding_steps" ADD CONSTRAINT "ambassador_onboarding_steps_lead_id_ambassador_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ambassador_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_onboarding_steps" ADD CONSTRAINT "ambassador_onboarding_steps_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_training_progress" ADD CONSTRAINT "ambassador_training_progress_lead_id_ambassador_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ambassador_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_training_progress" ADD CONSTRAINT "ambassador_training_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_training_progress" ADD CONSTRAINT "ambassador_training_progress_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ambassador_lead_activities_lead_idx" ON "ambassador_lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ambassador_leads_email_uq" ON "ambassador_leads" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "ambassador_leads_stage_idx" ON "ambassador_leads" USING btree ("stage","stage_changed_at");--> statement-breakpoint
CREATE INDEX "ambassador_leads_country_idx" ON "ambassador_leads" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "ambassador_leads_owner_idx" ON "ambassador_leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ambassador_leads_user_idx" ON "ambassador_leads" USING btree ("user_id");--> statement-breakpoint
-- Roles and permissions for the Ambassador programme, so existing databases get them without re-running the seed (the seed also writes them from core/permissions.ts).
INSERT INTO "permissions" ("key", "description") VALUES
  ('ambassador.manage', 'Create ambassador leads, move them through the pipeline, run onboarding and certify (own countries)'),
  ('ambassador.managers', 'Create and revoke ambassador manager accounts; choose the required training courses')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "requires_mfa") VALUES
  ('ambassador', 'Ambassador', false),
  ('ambassador_manager', 'Ambassador Manager', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p."key"
FROM (VALUES
  ('ambassador_manager', 'admin.console'),
  ('ambassador_manager', 'ambassador.manage'),
  ('platform_admin', 'ambassador.manage'),
  ('platform_admin', 'ambassador.managers'),
  ('super_admin', 'ambassador.manage'),
  ('super_admin', 'ambassador.managers')
) AS v("role_key", "permission_key")
JOIN "roles" r ON r."key" = v."role_key"
JOIN "permissions" p ON p."key" = v."permission_key"
ON CONFLICT DO NOTHING;
