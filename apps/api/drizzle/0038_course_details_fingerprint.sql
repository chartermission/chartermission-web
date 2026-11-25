ALTER TABLE "courses" ADD COLUMN "details_fingerprint" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "details_synced_at" timestamp with time zone;