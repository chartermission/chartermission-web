CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text,
	"expires_at" timestamp with time zone NOT NULL,
	"moderation_state" text DEFAULT 'visible' NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stories_mod_ck" CHECK ("stories"."moderation_state" in ('visible','hidden','removed'))
);
--> statement-breakpoint
CREATE TABLE "story_highlight_items" (
	"highlight_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_highlight_items_highlight_id_story_id_pk" PRIMARY KEY("highlight_id","story_id")
);
--> statement-breakpoint
CREATE TABLE "story_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_views" (
	"story_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_views_story_id_viewer_id_pk" PRIMARY KEY("story_id","viewer_id")
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "reports_target_ck";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "post_attachments" DROP CONSTRAINT "post_att_kind_ck";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "poster_key" text;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_highlight_items" ADD CONSTRAINT "story_highlight_items_highlight_id_story_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."story_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_highlight_items" ADD CONSTRAINT "story_highlight_items_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_highlights" ADD CONSTRAINT "story_highlights_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stories_author_idx" ON "stories" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "stories_expires_idx" ON "stories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "story_highlight_items_story_idx" ON "story_highlight_items" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_highlights_owner_idx" ON "story_highlights" USING btree ("owner_id","position");--> statement-breakpoint
CREATE INDEX "story_views_viewer_idx" ON "story_views" USING btree ("viewer_id");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "reports_target_ck" CHECK ("content_reports"."target_type" in ('post','comment','member','hashtag','story'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','post_image','post_document','post_video','event_cover','story_image','story_video'));--> statement-breakpoint
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_att_kind_ck" CHECK ("post_attachments"."kind" in ('image','document','video'));