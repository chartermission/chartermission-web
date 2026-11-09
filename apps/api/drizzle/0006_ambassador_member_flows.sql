ALTER TABLE "ambassador_lead_activities" DROP CONSTRAINT "ambassador_lead_activities_kind_ck";--> statement-breakpoint
ALTER TABLE "ambassador_leads" DROP CONSTRAINT "ambassador_leads_stage_ck";--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD COLUMN "agreement_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD COLUMN "agreement_signed_name" text;--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD COLUMN "agreement_version" text;--> statement-breakpoint
ALTER TABLE "ambassador_lead_activities" ADD CONSTRAINT "ambassador_lead_activities_kind_ck" CHECK ("ambassador_lead_activities"."kind" in ('created','updated','stage','note','scores','onboarding','training','invite','certified','term_ended','applied'));--> statement-breakpoint
ALTER TABLE "ambassador_leads" ADD CONSTRAINT "ambassador_leads_stage_ck" CHECK ("ambassador_leads"."stage" in ('new','screening','review','interview','references','decision','onboarding','ambassador','alumni','talent_pool','declined','withdrawn'));