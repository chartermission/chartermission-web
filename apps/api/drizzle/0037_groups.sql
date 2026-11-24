CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"decided_by" uuid,
	"request_answer" text,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id"),
	CONSTRAINT "group_members_role_ck" CHECK ("group_members"."role" in ('owner','admin','moderator','member')),
	CONSTRAINT "group_members_status_ck" CHECK ("group_members"."status" in ('active','pending','invited','banned'))
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"about" text,
	"rules" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"owner_type" text DEFAULT 'member' NOT NULL,
	"page_id" uuid,
	"chapter_id" uuid,
	"post_permission" text DEFAULT 'members' NOT NULL,
	"post_approval" boolean DEFAULT false NOT NULL,
	"join_question" text,
	"country_code" text,
	"logo_file_id" uuid,
	"cover_file_id" uuid,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_note" text,
	"featured_at" timestamp with time zone,
	"member_count" integer DEFAULT 0 NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"last_post_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "groups_visibility_ck" CHECK ("groups"."visibility" in ('public','private')),
	CONSTRAINT "groups_owner_type_ck" CHECK ("groups"."owner_type" in ('member','page','chapter')),
	CONSTRAINT "groups_owner_ck" CHECK (("groups"."owner_type" = 'member' and "groups"."page_id" is null and "groups"."chapter_id" is null) or ("groups"."owner_type" = 'page' and "groups"."page_id" is not null and "groups"."chapter_id" is null) or ("groups"."owner_type" = 'chapter' and "groups"."chapter_id" is not null and "groups"."page_id" is null)),
	CONSTRAINT "groups_post_permission_ck" CHECK ("groups"."post_permission" in ('members','admins')),
	CONSTRAINT "groups_status_ck" CHECK ("groups"."status" in ('active','suspended','archived'))
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "reports_target_ck";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_visibility_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "group_review" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "group_review_by" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "group_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "group_review_note" text;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "group_members_group_status_idx" ON "group_members" USING btree ("group_id","status","role");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_slug_uq" ON "groups" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "groups_status_idx" ON "groups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "groups_page_idx" ON "groups" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "groups_chapter_idx" ON "groups" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "groups_created_by_idx" ON "groups" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_review_by_users_id_fk" FOREIGN KEY ("group_review_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_group_idx" ON "posts" USING btree ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "reports_target_ck" CHECK ("content_reports"."target_type" in ('post','comment','member','hashtag','story','opportunity','message','initiative','group'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','initiative_cover','story_image','story_video','chapter_image','chapter_cover','page_logo','page_cover','group_logo','group_cover','product_image','profile_video','profile_resume','message_image','message_file','voice_note','certificate_signature'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_visibility_ck" CHECK ("posts"."visibility" <> 'group' or "posts"."group_id" is not null);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_review_ck" CHECK ("posts"."group_review" is null or "posts"."group_review" in ('pending','approved','declined'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_visibility_ck" CHECK ("posts"."visibility" in ('members','public','group'));