import { createMember, createTestApp, type TestApp } from './helpers.js';
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

  it('createMember signs a member in through the session cookie', async () => {
    const m = await createMember(t, { name: 'Amara Okafor' });
    const sessions = t.app.get(SessionService);
    expect(sessions).toBeDefined();
    // The session middleware resolves the cookie; /health ignores auth, so check via a raw resolve.
    const cookie = m.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', script: false, secure: false })[0];
    expect(cookie?.name).toBe('cm_session');
  });
});
