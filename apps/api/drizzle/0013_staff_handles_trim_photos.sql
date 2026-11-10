CREATE TABLE "handle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD COLUMN "stage_journey" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "photo_credit" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "photo_credit_url" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "trim_start_ms" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "trim_end_ms" integer;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "handle_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_official" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "handle_history" ADD CONSTRAINT "handle_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handle_history_handle_uq" ON "handle_history" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "handle_history_user_idx" ON "handle_history" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','story_image','story_video','chapter_image','chapter_cover','page_logo','page_cover'));--> statement-breakpoint
-- Until now every staff account was follow-only. From here on only accounts marked official are:
-- the platform's own account (Super Admin) stays official, individual staff connect like any member.
UPDATE "users" SET "is_official" = true
WHERE "is_staff" = true
  AND "id" IN (
    SELECT ur."user_id" FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."key" = 'super_admin' AND ur."revoked_at" IS NULL
  );
