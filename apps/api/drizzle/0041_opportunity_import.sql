ALTER TABLE "opportunities" ADD COLUMN "apply_url" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "source" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_page_idx" ON "opportunities" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_source_ck" CHECK ("opportunities"."source" in ('member','import'));