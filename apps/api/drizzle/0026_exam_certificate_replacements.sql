ALTER TABLE "exam_certificates" ADD COLUMN "replace_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "replace_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "replace_next_try_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "replace_error" text;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb NOT NULL;