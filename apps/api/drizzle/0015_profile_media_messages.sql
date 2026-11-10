CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_a" uuid NOT NULL,
	"member_b" uuid NOT NULL,
	"a_read_at" timestamp with time zone,
	"b_read_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_order_ck" CHECK ("conversations"."member_a" < "conversations"."member_b")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "intro_video_file_id" uuid;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "resume_file_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_member_a_users_id_fk" FOREIGN KEY ("member_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_member_b_users_id_fk" FOREIGN KEY ("member_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_pair_ux" ON "conversations" USING btree ("member_a","member_b");--> statement-breakpoint
CREATE INDEX "conversations_a_idx" ON "conversations" USING btree ("member_a","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_b_idx" ON "conversations" USING btree ("member_b","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','story_image','story_video','chapter_image','chapter_cover','page_logo','page_cover','profile_video','profile_resume'));