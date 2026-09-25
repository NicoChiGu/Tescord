import { chromium, request } from '@playwright/test';
import { randomBytes } from 'node:crypto';

const base = process.env.TESCORD_PUBLIC_URL || 'https://tescord.terata.top';
const api = await request.newContext({ baseURL: base, timeout: 15000 });
let browser;

async function account(prefix) {
  const marker = randomBytes(5).toString('hex');
  const email = `${prefix}-${marker}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const response = await api.post('/api/auth/register', {
    data: { username: `${prefix}_${marker}`, email, password },
  });
  if (response.status() !== 200) throw new Error(`${prefix} register HTTP ${response.status()}`);
  return { email, password };
}

try {
  const a = await account('sessiona');
  const b = await account('sessionb');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async ({ a, b }) => {
    const store = window.useAuthStore;
    if (!store) throw new Error('auth store not available');
    await store.getState().login({ emailOrUsername: a.email, password: a.password, rememberMe: false });
    const idA = store.getState().user?.id;
    const noPersistentRefresh = localStorage.getItem('tescord_refresh_token') === null;
    const sessionRefresh = Boolean(sessionStorage.getItem('tescord_refresh_token'));
    const refreshed = await store.getState().refreshAuth();
    const sameAfterRefresh = store.getState().user?.id === idA;
    store.getState().switchAccount();
    await store.getState().login({ emailOrUsername: a.email, password: a.password, rememberMe: true });
    const savedA = store.getState().savedAccounts.find((item) => item.id === idA);
    store.getState().switchAccount();
    await store.getState().login({ emailOrUsername: b.email, password: b.password, rememberMe: true });
    const idB = store.getState().user?.id;
    store.getState().switchAccount();
    const restoredA = await store.getState().loginWithSavedAccount(savedA);
    return { distinctAccounts: Boolean(idA && idB && idA !== idB),
      noPersistentRefresh, sessionRefresh, refreshed, sameAfterRefresh,
      savedA: Boolean(savedA?.refreshToken), restoredA,
      currentA: store.getState().user?.id === idA };
  }, { a, b });
  for (const [name, passed] of Object.entries(result)) {
    if (!passed) throw new Error(`public session ${name} failed`);
    console.log(`PASS public session ${name}`);
  }
} finally {
  await browser?.close().catch(() => {});
  await api.dispose();
}
