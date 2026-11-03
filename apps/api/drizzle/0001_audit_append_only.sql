-- Audit log is append-only (spec 5.4): the application can insert but never update or delete.
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS member_profiles_name_trgm ON member_profiles USING gin (display_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hashtags_tag_trgm ON hashtags USING gin (tag gin_trgm_ops);
