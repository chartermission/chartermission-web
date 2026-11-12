CREATE TABLE "exam_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_id" uuid,
	"course_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"image_file_id" uuid,
	"pdf_file_id" uuid,
	"post_id" uuid,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone,
	"last_error" text,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_certificates_status_ck" CHECK ("exam_certificates"."status" in ('pending','issued','failed'))
);
--> statement-breakpoint
CREATE TABLE "exam_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid,
	"sends" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "charter_center_course_id" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "share_certificates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "about_page_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "broadcast" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_certificates" ADD CONSTRAINT "exam_certificates_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_invites" ADD CONSTRAINT "exam_invites_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_invites" ADD CONSTRAINT "exam_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_certificates_member_uq" ON "exam_certificates" USING btree ("exam_id","user_id");--> statement-breakpoint
CREATE INDEX "exam_certificates_due_idx" ON "exam_certificates" USING btree ("status","next_try_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_invites_email_uq" ON "exam_invites" USING btree ("exam_id","email");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_about_page_id_pages_id_fk" FOREIGN KEY ("about_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_about_page_idx" ON "posts" USING btree ("about_page_id","created_at");