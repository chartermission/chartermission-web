CREATE TABLE "exam_access" (
	"exam_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_access_exam_id_user_id_pk" PRIMARY KEY("exam_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "exams" DROP CONSTRAINT "exams_access_ck";--> statement-breakpoint
ALTER TABLE "exam_access" ADD CONSTRAINT "exam_access_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_access" ADD CONSTRAINT "exam_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_access_user_idx" ON "exam_access" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "exam_certificates" DROP COLUMN "course_id";--> statement-breakpoint
ALTER TABLE "exams" DROP COLUMN "access";--> statement-breakpoint
ALTER TABLE "exams" DROP COLUMN "charter_center_course_id";--> statement-breakpoint
INSERT INTO "exam_access" ("exam_id", "user_id", "created_at")
SELECT "exam_id", "user_id", min("started_at") FROM "exam_attempts" WHERE NOT "preview" GROUP BY "exam_id", "user_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "exam_access" ("exam_id", "user_id", "created_at")
SELECT i."exam_id", u."id", i."created_at" FROM "exam_invites" i JOIN "users" u ON lower(u."email") = i."email" AND u."status" <> 'deleted'
ON CONFLICT DO NOTHING;
