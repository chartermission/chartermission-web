CREATE TABLE "profile_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"issue_date" text,
	"expiry_date" text,
	"credential_id" text,
	"credential_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD COLUMN "shown_on_profile" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_certifications" ADD CONSTRAINT "profile_certifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_certifications_user_idx" ON "profile_certifications" USING btree ("user_id");