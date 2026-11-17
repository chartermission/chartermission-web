CREATE TABLE "announcement_recipients" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emailed_at" timestamp with time zone,
	"messaged_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"email_skipped" text,
	"done_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "announcement_recipients_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"link_label" text,
	"channels" jsonb NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"emailed_count" integer DEFAULT 0 NOT NULL,
	"messaged_count" integer DEFAULT 0 NOT NULL,
	"notified_count" integer DEFAULT 0 NOT NULL,
	"opted_out_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" uuid,
	"sent_by" uuid,
	"queued_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_status_ck" CHECK ("announcements"."status" in ('draft','sending','sent','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "exam_instructors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"signature_file_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_kind_ck";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "announcement_id" uuid;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_instructors" ADD CONSTRAINT "exam_instructors_signature_file_id_files_id_fk" FOREIGN KEY ("signature_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_instructors" ADD CONSTRAINT "exam_instructors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_recipients_pending_idx" ON "announcement_recipients" USING btree ("announcement_id") WHERE "announcement_recipients"."done_at" is null;--> statement-breakpoint
CREATE INDEX "announcements_created_idx" ON "announcements" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_staff_id_users_id_fk" FOREIGN KEY ("sent_by_staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_ck" CHECK ("conversations"."kind" in ('direct','group','broadcast','official'));--> statement-breakpoint
-- One instructor per distinct signer + signature already used in exam certificate settings; each exam then points at it.
INSERT INTO "exam_instructors" ("name", "signature_file_id")
SELECT DISTINCT e."certificate"->>'issuerName', (e."certificate"->>'signatureFileId')::uuid
FROM "exams" e
WHERE e."certificate" ? 'issuerName' AND e."certificate" ? 'signatureFileId'
  AND EXISTS (SELECT 1 FROM "files" f WHERE f."id" = (e."certificate"->>'signatureFileId')::uuid);--> statement-breakpoint
UPDATE "exams" e
SET "certificate" = e."certificate" || jsonb_build_object('instructorId', i."id"::text)
FROM "exam_instructors" i
WHERE e."certificate"->>'issuerName' = i."name" AND (e."certificate"->>'signatureFileId')::uuid = i."signature_file_id";
