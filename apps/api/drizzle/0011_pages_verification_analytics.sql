CREATE TABLE "page_admins" (
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_admins_page_id_user_id_pk" PRIMARY KEY("page_id","user_id"),
	CONSTRAINT "page_admins_role_ck" CHECK ("page_admins"."role" in ('owner','admin'))
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"about" text,
	"category" text DEFAULT 'organisation' NOT NULL,
	"website" text,
	"country_code" text,
	"city" text,
	"logo_file_id" uuid,
	"cover_file_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"review_note" text,
	"verified_at" timestamp with time zone,
	"official" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_status_ck" CHECK ("pages"."status" in ('pending','active','rejected','suspended')),
	CONSTRAINT "pages_category_ck" CHECK ("pages"."category" in ('organisation','company','nonprofit','government','education','media','community','initiative'))
);
--> statement-breakpoint
CREATE TABLE "post_view_days" (
	"post_id" uuid NOT NULL,
	"day" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_view_days_post_id_day_pk" PRIMARY KEY("post_id","day")
);
--> statement-breakpoint
CREATE TABLE "post_views" (
	"post_id" uuid NOT NULL,
	"viewer_key" text NOT NULL,
	"country_code" text,
	"audience" text DEFAULT 'other' NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_views_post_id_viewer_key_pk" PRIMARY KEY("post_id","viewer_key"),
	CONSTRAINT "post_views_audience_ck" CHECK ("post_views"."audience" in ('connection','follower','other'))
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid,
	"category" text NOT NULL,
	"legal_name" text NOT NULL,
	"statement" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_requests_subject_ck" CHECK ("verification_requests"."subject_type" in ('member','page')),
	CONSTRAINT "verification_requests_status_ck" CHECK ("verification_requests"."status" in ('pending','approved','declined')),
	CONSTRAINT "verification_requests_page_ck" CHECK (("verification_requests"."subject_type" = 'page') = ("verification_requests"."page_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "follows" DROP CONSTRAINT "follows_type_ck";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "page_admins" ADD CONSTRAINT "page_admins_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_admins" ADD CONSTRAINT "page_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_view_days" ADD CONSTRAINT "post_view_days_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_views" ADD CONSTRAINT "post_views_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_admins_user_idx" ON "page_admins" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_uq" ON "pages" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "verification_requests_status_idx" ON "verification_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "verification_requests_user_idx" ON "verification_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requests_open_member_uq" ON "verification_requests" USING btree ("user_id") WHERE "verification_requests"."status" = 'pending' and "verification_requests"."subject_type" = 'member';--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requests_open_page_uq" ON "verification_requests" USING btree ("page_id") WHERE "verification_requests"."status" = 'pending' and "verification_requests"."subject_type" = 'page';--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_page_idx" ON "posts" USING btree ("page_id","created_at");--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_type_ck" CHECK ("follows"."target_type" in ('member','hashtag','chapter','page','organisation','initiative'));--> statement-breakpoint
-- Official (staff) accounts are follow-only. Members who were connected to one, or had asked to
-- connect, follow it instead; the connections themselves are closed.
INSERT INTO "follows" ("follower_id", "target_type", "target_id")
SELECT c."requester_id", 'member', c."addressee_id"::text
FROM "connections" c
JOIN "users" su ON su."id" = c."addressee_id" AND su."is_staff"
JOIN "users" mu ON mu."id" = c."requester_id" AND NOT mu."is_staff"
WHERE c."status" IN ('pending','accepted')
UNION
SELECT c."addressee_id", 'member', c."requester_id"::text
FROM "connections" c
JOIN "users" su ON su."id" = c."requester_id" AND su."is_staff"
JOIN "users" mu ON mu."id" = c."addressee_id" AND NOT mu."is_staff"
WHERE c."status" = 'accepted'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "connections" c
SET "status" = CASE WHEN c."status" = 'accepted' THEN 'removed' ELSE 'withdrawn' END, "responded_at" = now(), "updated_at" = now()
WHERE c."status" IN ('pending','accepted')
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."is_staff" AND u."id" IN (c."requester_id", c."addressee_id"));
