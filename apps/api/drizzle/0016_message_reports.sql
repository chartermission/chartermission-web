ALTER TABLE "content_reports" DROP CONSTRAINT "reports_target_ck";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "moderation_state" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "reports_target_ck" CHECK ("content_reports"."target_type" in ('post','comment','member','hashtag','story','opportunity','message'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_moderation_ck" CHECK ("messages"."moderation_state" in ('visible','hidden','removed'));