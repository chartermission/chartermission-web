// Loaded before every e2e test file (vitest setupFiles).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://postgres@localhost:55432/chartermission_test';
process.env.REDIS_URL ??= 'redis://localhost:56379/1';
process.env.QUEUE_INLINE = 'true';
process.env.RUN_WORKERS = 'false';
process.env.MAIL_DRIVER = 'log';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR ??= '/tmp/cm-test-uploads';
process.env.WEB_ORIGINS = 'http://localhost:3000,http://localhost:3001';
// Learning: always the fixture catalogue and fixture link checker (no outbound network in tests).
delete process.env.CHARTER_CENTER_API_URL;
