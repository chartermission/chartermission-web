// Loaded before every e2e test file (vitest setupFiles).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://postgres@localhost:5433/chartermission_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.QUEUE_INLINE = 'true';
process.env.RUN_WORKERS = 'false';
process.env.MAIL_DRIVER = 'log';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR ??= '/tmp/cm-test-uploads';
process.env.WEB_ORIGINS = 'http://localhost:3000,http://localhost:3001';
