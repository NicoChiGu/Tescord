import { chromium, request, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TESCORD_PUBLIC_URL || 'https://tescord.terata.top';
const marker = randomBytes(5).toString('hex');
const email = `media-${marker}@example.invalid`;
const password = randomBytes(24).toString('base64url');
const api = await request.newContext({ baseURL: base, timeout: 15000 });
let browser;
try {
  const registration = await api.post('/api/auth/register', {
    data: { username: `media_${marker}`, email, password },
  });
  if (registration.status() !== 200) throw new Error(`register HTTP ${registration.status()}`);
  const accessToken = (await registration.json()).accessToken;
  const guild = await api.post('/api/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: `Media acceptance ${marker}` },
  });
  if (guild.status() !== 200) throw new Error(`guild HTTP ${guild.status()}`);
  browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ locale: 'zh-CN', permissions: ['microphone', 'camera'] });
  await context.addInitScript(() => {
    const NativePC = window.RTCPeerConnection;
    window.__acceptancePCs = [];
    window.RTCPeerConnection = class extends NativePC {
      constructor(...args) {
        super(...args);
        window.__acceptancePCs.push(this);
      }
    };
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-submit-btn').click();
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-btn').click();
  await expect(page.getByTestId('current-user-panel-btn')).toBeVisible({ timeout: 20000 });
  const voice = page.locator('button[title="单击预览房间，双击加入语音通话"]').first();
  await expect(voice).toBeVisible({ timeout: 15000 });
  await voice.click();
  const join = page.getByRole('button', { name: '加入语音通话' });
  await expect(join).toBeVisible({ timeout: 10000 });
  await join.click();
  await page.waitForTimeout(25000);
  const evidence = await page.evaluate(async () => {
    const peers = [];
    for (const pc of window.__acceptancePCs || []) {
      const report = await pc.getStats();
      const pairs = [];
      const rtp = [];
      const candidates = [];
      for (const value of report.values()) {
        if (value.type === 'local-candidate' || value.type === 'remote-candidate') {
          candidates.push({ direction: value.type, candidateType: value.candidateType,
            address: value.address || value.ip, port: value.port, protocol: value.protocol });
        }
        if (value.type === 'candidate-pair' && (value.selected || value.nominated)) {
          const local = report.get(value.localCandidateId);
          const remote = report.get(value.remoteCandidateId);
          pairs.push({ state: value.state, nominated: value.nominated,
            localType: local?.candidateType, remoteType: remote?.candidateType,
            protocol: local?.protocol, bytesSent: value.bytesSent || 0,
            bytesReceived: value.bytesReceived || 0 });
        }
        if (value.type === 'outbound-rtp' || value.type === 'inbound-rtp') {
          const codec = report.get(value.codecId);
          rtp.push({ direction: value.type, kind: value.kind || value.mediaType,
            bytesSent: value.bytesSent || 0, bytesReceived: value.bytesReceived || 0,
            codec: codec?.mimeType || null });
        }
      }
      peers.push({ connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState,
        pairs, rtp, candidates });
    }
    return { peers, connectedLabel: document.body.innerText.includes('语音已连接') };
  });
  const outDir = resolve('test-results/public-acceptance');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'media-stats.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: resolve(outDir, 'media-attempt.png'), fullPage: true });
  console.log(JSON.stringify(evidence));
  const sent = evidence.peers.some((peer) => peer.rtp.some((row) => row.direction === 'outbound-rtp' && row.bytesSent > 0));
  const pair = evidence.peers.some((peer) => peer.pairs.some((row) => row.state === 'succeeded'));
  if (!sent || !pair) throw new Error(`media acceptance incomplete: selectedPair=${pair}, outboundRtp=${sent}`);
  console.log('PASS public media selected ICE pair and outbound RTP bytes');
} finally {
  await browser?.close().catch(() => {});
  await api.dispose();
}
