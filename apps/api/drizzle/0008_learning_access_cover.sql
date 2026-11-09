CREATE TABLE "learning_access_overrides" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"note" text,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_access_overrides" ADD CONSTRAINT "learning_access_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_access_overrides" ADD CONSTRAINT "learning_access_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','story_image','story_video'));