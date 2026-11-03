import { createTestApp, type TestApp } from './helpers.js';
import { SessionService } from '../src/core/session.service.js';
import { NotifyService } from '../src/core/notify.service.js';

describe('API foundation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves health and resolves dependency injection', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(t.app.get(SessionService)).toBeDefined();
    expect(t.app.get(NotifyService)).toBeDefined();
  });
});
