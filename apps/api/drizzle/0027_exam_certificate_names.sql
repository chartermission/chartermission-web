ALTER TABLE "exam_certificates" ADD COLUMN "certificate_name" text;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "name_status" text;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "proposed_name" text;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "name_declined_reason" text;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "name_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "name_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "name_confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "exam_certificates_name_idx" ON "exam_certificates" USING btree ("name_status","name_requested_at");--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_name_status_ck" CHECK ("exam_certificates"."name_status" is null or "exam_certificates"."name_status" in ('awaiting','review'));