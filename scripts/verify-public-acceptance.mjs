import { chromium, request, _electron as electron, expect } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const base = process.env.TESCORD_PUBLIC_URL || 'https://tescord.terata.top';
const exe = process.env.TESCORD_E2E_PACKAGED_EXE || resolve('apps/desktop/release/win-unpacked/Tescord.exe');
const marker = randomBytes(5).toString('hex');
const email = `public-${marker}@example.invalid`;
const password = randomBytes(24).toString('base64url');
const screenshotDir = resolve('test-results/public-acceptance');
await mkdir(screenshotDir, { recursive: true });
const api = await request.newContext({ baseURL: base, timeout: 15000 });
let browser;
let desktop;
let desktopDir;

async function checked(response, label, status = 200) {
  if (response.status() !== status) {
    throw new Error(`${label}: HTTP ${response.status()}, expected ${status}`);
  }
  console.log(`PASS ${label}: HTTP ${status}`);
  return response;
}

async function mainWindow(app) {
  const splash = await app.firstWindow();
  if (await splash.getByTestId('auth-email-input').isVisible().catch(() => false)) return splash;
  return app.waitForEvent('window', {
    predicate: (candidate) => candidate !== splash,
    timeout: 30000,
  });
}

try {
  await checked(await api.get('/healthz'), 'public health');
  const registration = await checked(await api.post('/api/auth/register', {
    data: { username: `public_${marker}`, email, password },
  }), 'public registration');
  const auth = await registration.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  await checked(await api.get('/api/guilds'), 'public anonymous guild denial', 401);

  const guild = await (await checked(await api.post('/api/guilds', {
    headers, data: { name: `Public acceptance ${marker}` },
  }), 'public guild create')).json();
  const channel = await (await checked(await api.post(`/api/guilds/${guild.id}/channels`, {
    headers, data: { name: 'public-acceptance', type: 'TEXT' },
  }), 'public channel create')).json();
  const bytes = Buffer.from(`Public Tunnel attachment ${marker}\n`);
  const grant = await (await checked(await api.post('/api/attachments/presigned-url', {
    headers,
    data: { fileName: 'acceptance.txt', fileSize: bytes.length, mimeType: 'text/plain', channelId: channel.id },
  }), 'public attachment grant')).json();
  await checked(await api.put(grant.uploadUrl, {
    headers: { ...headers, 'Content-Type': 'text/plain' }, data: bytes,
  }), 'public attachment upload');
  const message = await (await checked(await api.post(`/api/channels/${channel.id}/messages`, {
    headers,
    data: { content: `Public message ${marker}`, attachments: [{
      url: grant.fileUrl, fileName: 'acceptance.txt', fileSize: bytes.length, mimeType: 'text/plain',
    }] },
  }), 'public message create')).json();
  const downloaded = await checked(await api.get(message.attachments[0].url, { headers }), 'public signed attachment');
  if (createHash('sha256').update(await downloaded.body()).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) {
    throw new Error('public attachment SHA256 differs');
  }
  console.log('PASS public attachment SHA256 matches');
  await checked(await api.get(`/attachments/${grant.fileKey}`), 'public unsigned attachment denial', 403);
  const tampered = new URL(message.attachments[0].url);
  tampered.searchParams.set('signature', 'tampered');
  await checked(await api.get(tampered.toString(), { headers }), 'public tampered attachment denial', 403);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (event) => {
    if (event.type() === 'error') consoleErrors.push(event.text().slice(0, 240));
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('auth-email-input')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-submit-btn').click();
  await expect(page.getByTestId('auth-password-input')).toBeVisible();
  await page.getByTestId('auth-remember-me-checkbox').check();
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-btn').click();
  await expect(page.getByTestId('current-user-panel-btn')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: join(screenshotDir, 'web-desktop.png'), fullPage: true });
  console.log('PASS public Web login and rendered desktop');

  const gateway = await page.evaluate((token) => new Promise((resolve) => {
    const socket = new WebSocket(`wss://${location.host}/gateway`);
    const timeout = setTimeout(() => { socket.close(); resolve('timeout'); }, 10000);
    socket.onopen = () => socket.send(JSON.stringify({ op: 2, d: { token } }));
    socket.onmessage = (event) => {
      const packet = JSON.parse(event.data);
      if (packet.t === 'READY' || packet.op === 9) {
        clearTimeout(timeout); socket.close(); resolve(packet.t === 'READY' ? 'ready' : 'rejected');
      }
    };
    socket.onerror = () => { clearTimeout(timeout); resolve('error'); };
  }), auth.accessToken);
  if (gateway !== 'ready') throw new Error(`public Gateway ${gateway}`);
  console.log('PASS public Gateway IDENTIFY/READY');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('current-user-panel-btn')).toBeVisible({ timeout: 20000 });
  console.log('PASS public Web remembered login after reload');
  console.log(`Web console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors.slice(0, 5)) console.log(`WEB_CONSOLE_ERROR ${error}`);

  const mobile = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base, { waitUntil: 'domcontentloaded' });
  await expect(mobilePage.getByTestId('auth-email-input')).toBeVisible({ timeout: 20000 });
  await mobilePage.screenshot({ path: join(screenshotDir, 'web-mobile-login.png'), fullPage: true });
  console.log('PASS public mobile login layout renders');
  await mobile.close();
  await context.close();
  await browser.close();
  browser = undefined;

  desktopDir = await mkdtemp(join(resolve('test-results'), 'public-electron-'));
  const launchDesktop = () => electron.launch({
    executablePath: exe,
    env: { ...process.env, NODE_ENV: 'production', TESCORD_E2E_USER_DATA_DIR: desktopDir,
      TESCORD_E2E_SKIP_SINGLE_INSTANCE: 'true' },
    timeout: 30000,
  });
  desktop = await launchDesktop();
  let window = await mainWindow(desktop);
  await expect(window.getByTestId('auth-email-input')).toBeVisible({ timeout: 20000 });
  await window.getByTestId('auth-email-input').fill(email);
  await window.getByTestId('auth-submit-btn').click();
  await expect(window.getByTestId('auth-password-input')).toBeVisible();
  await window.getByTestId('auth-remember-me-checkbox').check();
  await window.getByTestId('auth-password-input').fill(password);
  await window.getByTestId('auth-submit-btn').click();
  window = await desktop.waitForEvent('window', {
    predicate: (candidate) => candidate !== window,
    timeout: 30000,
  });
  await expect(window.getByTestId('current-user-panel-btn')).toBeVisible({ timeout: 20000 });
  await window.screenshot({ path: join(screenshotDir, 'electron-online.png'), fullPage: true });
  console.log('PASS packaged Electron public login');
  await desktop.close();
  desktop = await launchDesktop();
  window = await mainWindow(desktop);
  await expect(window.getByTestId('current-user-panel-btn')).toBeVisible({ timeout: 20000 });
  console.log('PASS packaged Electron remembered login after restart');
} finally {
  await desktop?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await api.dispose();
  if (desktopDir) {
    const allowed = resolve('test-results') + sep;
    if (!desktopDir.startsWith(allowed)) throw new Error('unsafe Electron test directory');
    await rm(desktopDir, { recursive: true, force: true });
  }
}
