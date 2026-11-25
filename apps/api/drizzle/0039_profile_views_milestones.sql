CREATE TABLE "milestones_reached" (
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"threshold" integer NOT NULL,
	"reached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_reached_subject_type_subject_id_metric_threshold_pk" PRIMARY KEY("subject_type","subject_id","metric","threshold"),
	CONSTRAINT "milestones_subject_ck" CHECK ("milestones_reached"."subject_type" in ('post','member')),
	CONSTRAINT "milestones_metric_ck" CHECK ("milestones_reached"."metric" in ('impressions','reactions','followers','trending'))
);
--> statement-breakpoint
CREATE TABLE "profile_views" (
	"profile_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"day" date NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"anon_kind" text,
	"anon_name" text,
	CONSTRAINT "profile_views_profile_id_viewer_id_day_pk" PRIMARY KEY("profile_id","viewer_id","day"),
	CONSTRAINT "profile_views_anon_kind_ck" CHECK ("profile_views"."anon_kind" is null or "profile_views"."anon_kind" in ('company','chapter','member'))
);
--> statement-breakpoint
CREATE TABLE "search_appearances" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "search_appearances_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "profile_viewing" text DEFAULT 'named' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_profile_id_users_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_appearances" ADD CONSTRAINT "search_appearances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_views_profile_idx" ON "profile_views" USING btree ("profile_id","viewed_at");--> statement-breakpoint
CREATE INDEX "profile_views_viewer_idx" ON "profile_views" USING btree ("viewer_id");--> statement-breakpoint
CREATE INDEX "profile_views_day_idx" ON "profile_views" USING btree ("day");--> statement-breakpoint
CREATE INDEX "search_appearances_day_idx" ON "search_appearances" USING btree ("day");--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "profile_viewing_ck" CHECK ("member_profiles"."profile_viewing" in ('named','private'));