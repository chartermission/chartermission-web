CREATE TABLE "mfa_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"secret_enc" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_devices" ADD CONSTRAINT "mfa_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_devices_user_idx" ON "mfa_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_devices_user_secret_idx" ON "mfa_devices" USING btree ("user_id","secret_enc");--> statement-breakpoint
INSERT INTO "mfa_devices" ("user_id", "name", "secret_enc", "confirmed_at", "created_at")
SELECT "id", 'Authenticator app', "mfa_secret_enc", "mfa_enabled_at", "mfa_enabled_at"
FROM "users"
WHERE "mfa_secret_enc" IS NOT NULL AND "mfa_enabled_at" IS NOT NULL
ON CONFLICT DO NOTHING;
