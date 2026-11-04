CREATE TABLE "post_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"last_error" text,
	"published_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_drafts_status_ck" CHECK ("post_drafts"."status" in ('draft','scheduled','publishing','failed'))
);
--> statement-breakpoint
CREATE TABLE "post_help_offers" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_help_offers_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "post_attachments" ADD COLUMN "alt" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "type" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "accepted_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_help_offers" ADD CONSTRAINT "post_help_offers_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_help_offers" ADD CONSTRAINT "post_help_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_drafts_author_idx" ON "post_drafts" USING btree ("author_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "post_drafts_due_idx" ON "post_drafts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "post_help_offers_user_idx" ON "post_help_offers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posts_type_idx" ON "posts" USING btree ("type","created_at");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_type_ck" CHECK ("posts"."type" in ('standard','question','celebration','request','article'));