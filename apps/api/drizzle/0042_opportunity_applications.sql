ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD COLUMN "cv_file_id" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "staff_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD CONSTRAINT "opportunity_applications_cv_file_id_files_id_fk" FOREIGN KEY ("cv_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','initiative_cover','story_image','story_video','chapter_image','chapter_cover','page_logo','page_cover','group_logo','group_cover','product_image','profile_video','profile_resume','application_cv','message_image','message_file','voice_note','certificate_signature'));--> statement-breakpoint
UPDATE "pages" SET "staff_managed" = true WHERE "official" = true;
