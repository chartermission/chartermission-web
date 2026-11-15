CREATE TABLE "booking_reminders_sent" (
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"offset_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_reminders_sent_booking_id_user_id_offset_minutes_pk" PRIMARY KEY("booking_id","user_id","offset_minutes")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"host_user_id" uuid,
	"host_page_id" uuid,
	"booker_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"note" text,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_status_ck" CHECK ("bookings"."status" in ('confirmed','cancelled')),
	CONSTRAINT "bookings_cancelled_by_ck" CHECK ("bookings"."cancelled_by" is null or "bookings"."cancelled_by" in ('booker','host')),
	CONSTRAINT "bookings_host_ck" CHECK (("bookings"."host_user_id" is null) <> ("bookings"."host_page_id" is null)),
	CONSTRAINT "bookings_time_ck" CHECK ("bookings"."ends_at" > "bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "host_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_user_id" uuid,
	"host_page_id" uuid,
	"timezone" text NOT NULL,
	"windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"days_off" text[] DEFAULT '{}'::text[] NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"max_per_day" integer,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_availability_host_ck" CHECK (("host_availability"."host_user_id" is null) <> ("host_availability"."host_page_id" is null))
);
--> statement-breakpoint
CREATE TABLE "page_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"about_type" text,
	"about_id" uuid,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"conversation_id" uuid,
	"replied_by" uuid,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_enquiries_status_ck" CHECK ("page_enquiries"."status" in ('new','replied','closed')),
	CONSTRAINT "page_enquiries_about_ck" CHECK ("page_enquiries"."about_type" is null or "page_enquiries"."about_type" in ('product','service'))
);
--> statement-breakpoint
CREATE TABLE "page_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" text,
	"image_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"link" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_sectors" (
	"page_id" uuid NOT NULL,
	"sector_id" uuid NOT NULL,
	CONSTRAINT "page_sectors_page_id_sector_id_pk" PRIMARY KEY("page_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_user_id" uuid,
	"host_page_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"rate_note" text,
	"bookable" boolean DEFAULT false NOT NULL,
	"duration_minutes" integer,
	"mode" text,
	"location_hint" text,
	"meeting_details" text,
	"notice_hours" integer DEFAULT 12 NOT NULL,
	"window_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_host_ck" CHECK (("services"."host_user_id" is null) <> ("services"."host_page_id" is null)),
	CONSTRAINT "services_mode_ck" CHECK ("services"."mode" is null or "services"."mode" in ('video','phone','in_person'))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_ck";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "hours" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "founded_year" integer;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "team_size" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "specialties" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_reminders_sent" ADD CONSTRAINT "booking_reminders_sent_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminders_sent" ADD CONSTRAINT "booking_reminders_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_page_id_pages_id_fk" FOREIGN KEY ("host_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booker_id_users_id_fk" FOREIGN KEY ("booker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_availability" ADD CONSTRAINT "host_availability_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_availability" ADD CONSTRAINT "host_availability_host_page_id_pages_id_fk" FOREIGN KEY ("host_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_availability" ADD CONSTRAINT "host_availability_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_enquiries" ADD CONSTRAINT "page_enquiries_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_enquiries" ADD CONSTRAINT "page_enquiries_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_enquiries" ADD CONSTRAINT "page_enquiries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_enquiries" ADD CONSTRAINT "page_enquiries_replied_by_users_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_products" ADD CONSTRAINT "page_products_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_products" ADD CONSTRAINT "page_products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_sectors" ADD CONSTRAINT "page_sectors_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_sectors" ADD CONSTRAINT "page_sectors_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_host_page_id_pages_id_fk" FOREIGN KEY ("host_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_host_user_idx" ON "bookings" USING btree ("host_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_host_page_idx" ON "bookings" USING btree ("host_page_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_booker_idx" ON "bookings" USING btree ("booker_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_service_idx" ON "bookings" USING btree ("service_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_availability_user_uq" ON "host_availability" USING btree ("host_user_id") WHERE "host_availability"."host_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "host_availability_page_uq" ON "host_availability" USING btree ("host_page_id") WHERE "host_availability"."host_page_id" is not null;--> statement-breakpoint
CREATE INDEX "page_enquiries_page_idx" ON "page_enquiries" USING btree ("page_id","status","created_at");--> statement-breakpoint
CREATE INDEX "page_enquiries_from_idx" ON "page_enquiries" USING btree ("from_id","created_at");--> statement-breakpoint
CREATE INDEX "page_products_page_idx" ON "page_products" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "services_user_idx" ON "services" USING btree ("host_user_id","position");--> statement-breakpoint
CREATE INDEX "services_page_idx" ON "services" USING btree ("host_page_id","position");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('avatar','profile_cover','post_image','post_document','post_video','event_cover','initiative_cover','story_image','story_video','chapter_image','chapter_cover','page_logo','page_cover','product_image','profile_video','profile_resume','message_image','message_file','voice_note'));--> statement-breakpoint
UPDATE "platform_settings" SET "value" = jsonb_set("value", '{memberCreation}', '"open"'), "updated_at" = now() WHERE "key" = 'pages' AND "value"->>'memberCreation' = 'review';
--> statement-breakpoint
UPDATE "pages" SET "status" = 'active', "review_note" = NULL, "updated_at" = now() WHERE "status" = 'pending';
