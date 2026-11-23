ALTER TABLE "post_drafts" DROP CONSTRAINT "post_drafts_status_ck";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_status_ck";--> statement-breakpoint
ALTER TABLE "course_topics" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_categories" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "interests" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "content_review" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "content_review_by" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "content_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "content_review_note" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_review" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_review_by" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_review_note" text;--> statement-breakpoint
ALTER TABLE "sectors" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_content_review_by_users_id_fk" FOREIGN KEY ("content_review_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_content_review_by_users_id_fk" FOREIGN KEY ("content_review_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_drafts_source_idx" ON "post_drafts" USING btree ("source","scheduled_for");--> statement-breakpoint
CREATE INDEX "posts_source_idx" ON "posts" USING btree ("source","created_at");--> statement-breakpoint
ALTER TABLE "course_topics" ADD CONSTRAINT "course_topics_status_ck" CHECK ("course_topics"."status" in ('active','hidden'));--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_status_ck" CHECK ("event_categories"."status" in ('active','hidden'));--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_status_ck" CHECK ("interests"."status" in ('active','hidden'));--> statement-breakpoint
ALTER TABLE "languages" ADD CONSTRAINT "languages_status_ck" CHECK ("languages"."status" in ('active','hidden'));--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_source_ck" CHECK ("post_drafts"."source" in ('web','claude'));--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_content_review_ck" CHECK ("post_drafts"."content_review" is null or "post_drafts"."content_review" in ('pending','approved','declined'));--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_status_ck" CHECK ("post_drafts"."status" in ('draft','scheduled','publishing','failed','held'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_source_ck" CHECK ("posts"."source" in ('web','claude'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_content_review_ck" CHECK ("posts"."content_review" is null or "posts"."content_review" in ('pending','approved','declined'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_ck" CHECK ("posts"."status" in ('pending_media','published','in_review','declined','awaiting_approval'));--> statement-breakpoint
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_status_ck" CHECK ("sectors"."status" in ('active','hidden'));--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_status_ck" CHECK ("skills"."status" in ('active','hidden'));