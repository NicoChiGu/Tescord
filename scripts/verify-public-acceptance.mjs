import { chromium, request, _electron as electron, expect } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
    const failure = await response.json().catch(() => ({}));
    throw new Error(`${label}: HTTP ${response.status()}, expected ${status}, code ${failure.code || 'unknown'}`);
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

async function mediaStats(page) {
  return page.evaluate(async () => Promise.all((window.__acceptanceMediaPcs || []).map(async (pc) => {
    const report = await pc.getStats();
    const selectedId = [...report.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId)?.selectedCandidatePairId;
    const pair = [...report.values()].find(item => item.type === 'candidate-pair' && item.state === 'succeeded' && (item.id === selectedId || item.nominated));
    const rtp = [...report.values()].filter(item => item.type === 'inbound-rtp' || item.type === 'outbound-rtp')
      .map(item => ({ direction: item.type, kind: item.kind, bytes: item.bytesReceived || item.bytesSent || 0,
        codec: report.get(item.codecId)?.mimeType || null, frames: item.framesDecoded || 0 }));
    return { state: pc.connectionState, localType: report.get(pair?.localCandidateId)?.candidateType || null, rtp,
      senders: pc.getSenders().map(sender => sender.track ? { kind: sender.track.kind, readyState: sender.track.readyState,
        enabled: sender.track.enabled, muted: sender.track.muted } : null) };
  })));
}

async function joinVoice(page, guildName) {
  await page.getByRole('button', { name: guildName, exact: true }).click();
  await page.locator('button[title="单击预览房间，双击加入语音通话"]').first().click();
  await page.getByRole('button', { name: '加入语音通话' }).click();
  await expect(page.getByRole('button', { name: '断开连接' }).first()).toBeVisible({ timeout: 45000 });
}

try {
  await checked(await api.get('/healthz'), 'public health');
  let inviteCode;
  let adminToken;
  if (process.env.TESCORD_ACCEPTANCE_ADMIN_PASSWORD) {
    const adminLogin = await checked(await api.post('/api/auth/login', {
      data: {
        emailOrUsername: process.env.TESCORD_ACCEPTANCE_ADMIN_USERNAME || 'AcceptanceAdmin',
        password: process.env.TESCORD_ACCEPTANCE_ADMIN_PASSWORD,
      },
    }), 'acceptance administrator login');
    const admin = await adminLogin.json();
    adminToken = admin.accessToken;
    const invite = await checked(await api.post('/api/admin/registration-invites', {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      data: { note: `Public acceptance ${marker}`, maxUses: 1 },
    }), 'acceptance registration invite');
    inviteCode = (await invite.json()).code;
  }
  const registration = await checked(await api.post('/api/auth/register', {
    data: { username: `public_${marker}`, email, password, ...(inviteCode ? { inviteCode } : {}) },
  }), 'public registration');
  const auth = await registration.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  await checked(await api.get('/api/guilds'), 'public anonymous guild denial', 401);

  const guild = await (await checked(await api.post('/api/guilds', {
    headers, data: { name: `Public acceptance ${marker}` },
  }), 'public guild create')).json();
  const secondInvite = adminToken ? await (await checked(await api.post('/api/admin/registration-invites', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { note: `Electron media peer ${marker}`, maxUses: 1 },
  }), 'second acceptance invite')).json() : null;
  const secondRegistration = await (await checked(await api.post('/api/auth/register', {
    data: { username: `electron_peer_${marker}`, email: `electron-peer-${marker}@example.invalid`,
      password: randomBytes(24).toString('base64url'), ...(secondInvite ? { inviteCode: secondInvite.code } : {}) },
  }), 'second acceptance registration')).json();
  const guildInvite = await (await checked(await api.post(`/api/guilds/${guild.id}/invites`, {
    headers, data: { maxUses: 1 },
  }), 'acceptance guild invite')).json();
  await checked(await api.post(`/api/invites/${guildInvite.code}/join`, {
    headers: { Authorization: `Bearer ${secondRegistration.accessToken}` },
  }), 'second acceptance member join');
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
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
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

  await window.evaluate(() => {
    const NativePC = window.RTCPeerConnection;
    window.__acceptanceMediaPcs = [];
    window.RTCPeerConnection = class extends NativePC {
      constructor(...args) { super(...args); window.__acceptanceMediaPcs.push(this); }
    };
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const captureCleanup = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.video) return nativeGetUserMedia(constraints);
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      let frame = 0;
      const paint = () => {
        context.fillStyle = frame++ % 2 ? '#18888f' : '#df744d';
        context.fillRect(0, 0, canvas.width, canvas.height);
      };
      paint();
      const timer = setInterval(paint, 100);
      const stream = canvas.captureStream(15);
      captureCleanup.push(() => { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); });
      if (constraints.audio) {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const destination = audio.createMediaStreamDestination();
        gain.gain.value = 0.02;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        stream.addTrack(destination.stream.getAudioTracks()[0]);
        captureCleanup.push(() => { oscillator.stop(); void audio.close(); });
      }
      return stream;
    };
    window.__acceptanceCaptureCleanup = () => captureCleanup.forEach(cleanup => cleanup());
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    });
  });
  const electronDiagnostics = [];
  window.on('console', event => {
    if (event.type() === 'error' || event.type() === 'warning') electronDiagnostics.push({ event: 'console', message: event.text().slice(0, 220) });
  });
  window.on('response', response => {
    if (response.url().includes('/api/cloudflare-realtime/')) electronDiagnostics.push({ event: 'cloudflare_api', path: new URL(response.url()).pathname, status: response.status() });
  });
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const peerContext = await browser.newContext({ locale: 'zh-CN', permissions: ['microphone', 'camera'] });
  await peerContext.addInitScript((token) => {
    localStorage.setItem('tescord_access_token', token);
    const NativePC = window.RTCPeerConnection;
    window.__acceptanceMediaPcs = [];
    window.RTCPeerConnection = class extends NativePC {
      constructor(...args) { super(...args); window.__acceptanceMediaPcs.push(this); }
    };
  }, secondRegistration.accessToken);
  const peerPage = await peerContext.newPage();
  await peerPage.goto(base);
  await expect(peerPage.getByTestId('current-user-panel-btn')).toBeVisible({ timeout: 20000 });
  try {
    await joinVoice(window, guild.name);
  } catch (error) {
    console.log(JSON.stringify({ stage: 'electron_join', diagnostics: electronDiagnostics.slice(-30), stats: await mediaStats(window) }));
    throw error;
  }
  await joinVoice(peerPage, guild.name);
  try {
    await expect.poll(async () => {
      const all = await Promise.all([mediaStats(window), mediaStats(peerPage)]);
      return all.every(rows => rows.some(row => row.state === 'connected' &&
        row.rtp.some(item => item.direction === 'inbound-rtp' && item.kind === 'audio' && item.bytes > 1000) &&
        row.rtp.some(item => item.direction === 'outbound-rtp' && item.kind === 'audio' && item.bytes > 1000)));
    }, { timeout: 45000 }).toBe(true);
  } catch (error) {
    console.log(JSON.stringify({ stage: 'electron_media', diagnostics: electronDiagnostics.slice(-30), stats: await Promise.all([mediaStats(window), mediaStats(peerPage)]) }));
    throw error;
  }
  const mediaBefore = await Promise.all([mediaStats(window), mediaStats(peerPage)]);
  await window.waitForTimeout(1200);
  const mediaAfter = await Promise.all([mediaStats(window), mediaStats(peerPage)]);
  for (let i = 0; i < 2; i++) {
    for (const direction of ['inbound-rtp', 'outbound-rtp']) {
      const bytes = rows => rows.flatMap(row => row.rtp).filter(item => item.direction === direction && item.kind === 'audio').reduce((sum, item) => sum + item.bytes, 0);
      if (bytes(mediaAfter[i]) <= bytes(mediaBefore[i])) throw new Error(`Electron media ${direction} bytes did not increase`);
    }
  }
  await writeFile(join(screenshotDir, 'electron-media-stats.json'), JSON.stringify({ before: mediaBefore, after: mediaAfter }, null, 2));
  await window.screenshot({ path: join(screenshotDir, 'electron-media.png'), fullPage: true });
  console.log('PASS packaged Electron file:// and public Chromium exchange bidirectional Opus RTP');
  await window.getByTestId('voice-toggle-camera-btn').click();
  try {
    await expect.poll(async () => (await mediaStats(peerPage)).some(row => row.rtp.some(item =>
      item.direction === 'inbound-rtp' && item.kind === 'video' && item.bytes > 1000 && item.frames > 0
    )), { timeout: 45000 }).toBe(true);
  } catch (error) {
    console.log(JSON.stringify({ stage: 'electron_camera', diagnostics: electronDiagnostics.slice(-30), stats: await Promise.all([mediaStats(window), mediaStats(peerPage)]) }));
    throw error;
  }
  console.log('PASS packaged Electron camera reaches public Chromium as decoded video');
  await window.getByTestId('voice-toggle-camera-btn').click();
  await window.getByTestId('voice-toggle-screen-btn').click();
  await window.getByTestId('screen-share-audio-checkbox').check({ force: true });
  await window.getByTestId('start-screen-share-confirm-btn').click();
  try {
    await expect.poll(async () => (await mediaStats(peerPage)).some(row =>
      row.rtp.filter(item => item.direction === 'inbound-rtp' && item.kind === 'video' && item.frames > 0).length >= 2 &&
      row.rtp.filter(item => item.direction === 'inbound-rtp' && item.kind === 'audio' && item.bytes > 1000).length >= 2
    ), { timeout: 45000 }).toBe(true);
  } catch (error) {
    console.log(JSON.stringify({ stage: 'electron_screen', diagnostics: electronDiagnostics.slice(-30), stats: await Promise.all([mediaStats(window), mediaStats(peerPage)]) }));
    throw error;
  }
  await writeFile(join(screenshotDir, 'electron-screen-stats.json'), JSON.stringify(await Promise.all([mediaStats(window), mediaStats(peerPage)]), null, 2));
  await window.screenshot({ path: join(screenshotDir, 'electron-screen.png'), fullPage: true });
  console.log('PASS packaged Electron screen video and shared audio reach public Chromium');
} finally {
  for (const page of desktop?.windows() || []) {
    await page.evaluate(() => window.__acceptanceCaptureCleanup?.()).catch(() => {});
  }
  await desktop?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await api.dispose();
  if (desktopDir) {
    const allowed = resolve('test-results') + sep;
    if (!desktopDir.startsWith(allowed)) throw new Error('unsafe Electron test directory');
    await rm(desktopDir, { recursive: true, force: true });
  }
}
