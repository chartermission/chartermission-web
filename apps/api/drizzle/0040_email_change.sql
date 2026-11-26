ALTER TABLE "auth_tokens" DROP CONSTRAINT "auth_tokens_purpose_ck";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_purpose_ck" CHECK ("auth_tokens"."purpose" in ('verify','reset','email_change'));