CREATE TABLE "initiative_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid,
	"skills" text,
	"note" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_join_requests_status_ck" CHECK ("initiative_join_requests"."status" in ('pending','accepted','declined','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "initiative_members" (
	"initiative_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text,
	"organiser" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_members_initiative_id_user_id_pk" PRIMARY KEY("initiative_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "initiative_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"target_date" text,
	"done_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiative_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sector_id" uuid,
	"country_code" text,
	"status" text DEFAULT 'recruiting' NOT NULL,
	"host_type" text DEFAULT 'member' NOT NULL,
	"host_page_id" uuid,
	"host_chapter_id" uuid,
	"lead_id" uuid NOT NULL,
	"cover_file_id" uuid,
	"moderation_state" text DEFAULT 'visible' NOT NULL,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiatives_slug_unique" UNIQUE("slug"),
	CONSTRAINT "initiatives_status_ck" CHECK ("initiatives"."status" in ('idea','recruiting','active','paused','completed','archived')),
	CONSTRAINT "initiatives_host_ck" CHECK ("initiatives"."host_type" in ('member','page','chapter')),
	CONSTRAINT "initiatives_moderation_ck" CHECK ("initiatives"."moderation_state" in ('visible','hidden','removed'))
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "reports_target_ck";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "initiative_id" uuid;--> statement-breakpoint
ALTER TABLE "initiative_join_requests" ADD CONSTRAINT "initiative_join_requests_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_join_requests" ADD CONSTRAINT "initiative_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_join_requests" ADD CONSTRAINT "initiative_join_requests_role_id_initiative_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."initiative_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_join_requests" ADD CONSTRAINT "initiative_join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_members" ADD CONSTRAINT "initiative_members_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_members" ADD CONSTRAINT "initiative_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_milestones" ADD CONSTRAINT "initiative_milestones_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_roles" ADD CONSTRAINT "initiative_roles_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_host_page_id_pages_id_fk" FOREIGN KEY ("host_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_host_chapter_id_chapters_id_fk" FOREIGN KEY ("host_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_join_requests_idx" ON "initiative_join_requests" USING btree ("initiative_id","status","created_at");--> statement-breakpoint
CREATE INDEX "initiative_join_requests_user_idx" ON "initiative_join_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "initiative_join_requests_pending_uq" ON "initiative_join_requests" USING btree ("initiative_id","user_id") WHERE "initiative_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "initiative_members_user_idx" ON "initiative_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "initiative_milestones_idx" ON "initiative_milestones" USING btree ("initiative_id","position");--> statement-breakpoint
CREATE INDEX "initiative_roles_idx" ON "initiative_roles" USING btree ("initiative_id","position");--> statement-breakpoint
CREATE INDEX "initiatives_list_idx" ON "initiatives" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "initiatives_host_page_idx" ON "initiatives" USING btree ("host_page_id");--> statement-breakpoint
CREATE INDEX "initiatives_host_chapter_idx" ON "initiatives" USING btree ("host_chapter_id");--> statement-breakpoint
CREATE INDEX "initiatives_lead_idx" ON "initiatives" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_initiative_idx" ON "posts" USING btree ("initiative_id","created_at");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "reports_target_ck" CHECK ("content_reports"."target_type" in ('post','comment','member','hashtag','story','opportunity','message','initiative'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','initiative_cover','story_image','story_video','chapter_image','chapter_cover','page_logo','page_cover','profile_video','profile_resume','message_image','message_file','voice_note'));