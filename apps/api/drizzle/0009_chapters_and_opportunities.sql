CREATE TABLE "chapter_pins" (
	"chapter_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"pinned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_pins_chapter_id_post_id_pk" PRIMARY KEY("chapter_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"poster_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"organisation" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"remote_mode" text NOT NULL,
	"country_code" text,
	"city" text,
	"sector_id" uuid,
	"deadline" text,
	"compensation" text,
	"more_info_url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"moderation_state" text DEFAULT 'visible' NOT NULL,
	"application_count" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "opportunities_type_ck" CHECK ("opportunities"."type" in ('employment','internship','fellowship','scholarship','grant','training','mentorship','volunteering','competition','call_for_proposals')),
	CONSTRAINT "opportunities_remote_ck" CHECK ("opportunities"."remote_mode" in ('remote','in_person','hybrid')),
	CONSTRAINT "opportunities_status_ck" CHECK ("opportunities"."status" in ('open','closed')),
	CONSTRAINT "opportunities_mod_ck" CHECK ("opportunities"."moderation_state" in ('visible','hidden','removed'))
);
--> statement-breakpoint
CREATE TABLE "opportunity_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_applications_status_ck" CHECK ("opportunity_applications"."status" in ('submitted','shortlisted','accepted','declined','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "reports_target_ck";--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "chapter_pins" ADD CONSTRAINT "chapter_pins_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_pins" ADD CONSTRAINT "chapter_pins_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_pins" ADD CONSTRAINT "chapter_pins_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_poster_id_users_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD CONSTRAINT "opportunity_applications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD CONSTRAINT "opportunity_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_pins_post_idx" ON "chapter_pins" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "opportunities_poster_idx" ON "opportunities" USING btree ("poster_id","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_list_idx" ON "opportunities" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_deadline_idx" ON "opportunities" USING btree ("deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_applications_uq" ON "opportunity_applications" USING btree ("opportunity_id","applicant_id");--> statement-breakpoint
CREATE INDEX "opportunity_applications_applicant_idx" ON "opportunity_applications" USING btree ("applicant_id","created_at");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "reports_target_ck" CHECK ("content_reports"."target_type" in ('post','comment','member','hashtag','story','opportunity'));--> statement-breakpoint
-- Chapter page management for platform staff, and event proposals for every member, so existing databases get them without re-running the seed.
INSERT INTO "permissions" ("key", "description") VALUES
  ('chapter.manage', 'Pin posts and edit the About text on any chapter page')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p."key"
FROM (VALUES
  ('platform_admin', 'chapter.manage'),
  ('super_admin', 'chapter.manage'),
  ('member', 'event.create')
) AS v("role_key", "permission_key")
JOIN "roles" r ON r."key" = v."role_key"
JOIN "permissions" p ON p."key" = v."permission_key"
ON CONFLICT DO NOTHING;
