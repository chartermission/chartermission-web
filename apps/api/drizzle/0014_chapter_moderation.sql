CREATE TABLE "chapter_bans" (
	"chapter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"banned_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_bans_chapter_id_user_id_pk" PRIMARY KEY("chapter_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_status_ck";--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "post_approval" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "chapter_review" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "chapter_review_by" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "chapter_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "chapter_review_note" text;--> statement-breakpoint
ALTER TABLE "chapter_bans" ADD CONSTRAINT "chapter_bans_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_bans" ADD CONSTRAINT "chapter_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_bans" ADD CONSTRAINT "chapter_bans_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_bans_user_idx" ON "chapter_bans" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_chapter_review_by_users_id_fk" FOREIGN KEY ("chapter_review_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_post_approval_ck" CHECK ("chapters"."post_approval" is null or "chapters"."post_approval" in ('direct','review'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_chapter_review_ck" CHECK ("posts"."chapter_review" is null or "posts"."chapter_review" in ('pending','approved','declined'));--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_ck" CHECK ("posts"."status" in ('pending_media','published','in_review','declined'));