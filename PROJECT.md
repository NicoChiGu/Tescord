# Project: Tescord P2P Metrics, Media Adaptive & Image UX Refactor

## Architecture

- **packages/types**: System-wide contracts. Exports `PeerLatencyReport` (extended with `localAddress`, `remoteAddress`, `candidateType`), removals of deprecated `AudioMixerConfig` and `computeMixGains`.
- **apps/web/src/services/p2p**: P2P mesh management. `ipClassifier.ts` implements RFC 1918, RFC 4193 ULA, Link-Local, Loopback classification; `VoiceMeshManager.ts` consumes candidate pair addresses, classifies LAN vs P2P vs RELAY.
- **apps/web/src/components/voice & ChannelSidebar**: Voice status UI. `ChannelSidebar.tsx` decouples bottom-left voice status bar (click channel -> stage, click status -> popover); `VoiceConnectionStatusPopover.tsx` renders P2P latency bar charts with avatars and health coloring; `VoiceRoomArea.tsx` dynamically sizes focused videos to natural aspect ratios and removes deprecated audio mixer.
- **apps/web/src/components/modals**: `NetworkQualityModal.tsx` displays local and remote direct IP & port for P2P peers.
- **apps/web/src/components/chat**: Image UX. `ImageAttachment.tsx` provides shimmering skeleton and smooth fade-in; `LightboxModal.tsx` provides centered frosted-glass radial progress ring, cross-fade to full HD, and glowing HD badge.
- **apps/web/src/i18n/locales**: Strict 5-locale symmetry across `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`.
- **scripts/ & e2e/**: Node.js test runner for IP classification unit test (`scripts/test-p2p-ip-classification.ts`) and Playwright E2E test verification.

## Feature Inventory

| #   | Feature                                               | Description                                                                                                                     | Milestone | Source                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| 1   | R1: IP Classifier Utility                             | RFC 1918, RFC 4193 ULA, Link-Local, Loopback vs Public IPv6 (2000::/3)                                                          | MA        | ORIGINAL_REQUEST §R1  |
| 2   | R1: P2P LAN Identification Fix                        | VoiceMeshManager.ts checks host candidates + private IP on both sides for LAN; public IPv6 direct is P2P; relay is RELAY        | MA        | ORIGINAL_REQUEST §R1  |
| 3   | R1: IP Classifier Unit Test                           | scripts/test-p2p-ip-classification.ts asserting public IPv6, RFC 1918, ULA, Loopback, Relay                                     | MA        | ORIGINAL_REQUEST §AC1 |
| 4   | R4: Types Extension                                   | PeerLatencyReport extended with localAddress, remoteAddress, candidateType                                                      | MA        | ORIGINAL_REQUEST §R4  |
| 5   | R4: VoiceMeshManager IP Extraction                    | getStats() extracts selected candidate pair local/remote addresses and stores in latencyReports                                 | MA        | ORIGINAL_REQUEST §R4  |
| 6   | R5: Audio Mixer Code & Types Removal                  | Delete audioMixer.ts, remove AudioMixerConfig & computeMixGains from types, update server verify-phase4-full.ts                 | MA        | ORIGINAL_REQUEST §R5  |
| 7   | R5: Audio Mixer UI Removal & Screen Share Integrity   | Remove mixer button & console modal from VoiceRoomArea.tsx, ensure getDisplayMedia screen audio unaffected                      | MA        | ORIGINAL_REQUEST §R5  |
| 8   | R2: Popover P2P Metrics & Avatar Bar Chart            | VoiceConnectionStatusPopover displays avg RTT, packet loss, member bar chart with avatar and ms, health colors, hover tooltip   | MB        | ORIGINAL_REQUEST §R2  |
| 9   | R2: Bottom-left Status Bar Decouple                   | Remove median latency text; decouple channel click (navigate stage) from status icon click (toggle popover) in ChannelSidebar   | MB        | ORIGINAL_REQUEST §R2  |
| 10  | R3: Voice Focus Mode Adaptive Aspect Ratio            | VoiceRoomArea listens to videoWidth/videoHeight, applies dynamic aspectRatio, eliminates black borders, max-h-[72vh] max-w-full | MB        | ORIGINAL_REQUEST §R3  |
| 11  | R4: Network Quality Modal Direct IP                   | NetworkQualityModal displays local and remote IP:port for P2P peers                                                             | MB        | ORIGINAL_REQUEST §R4  |
| 12  | R6: Image Shimmer Skeleton & Fade-in                  | ImageAttachment.tsx shimmering skeleton and opacity transition on load                                                          | MB        | ORIGINAL_REQUEST §R6  |
| 13  | R6: Lightbox Frosted Glass Radial Progress & HD Badge | LightboxModal.tsx centered radial progress with percent/size, cross-fade to full resolution, HD badge                           | MB        | ORIGINAL_REQUEST §R6  |
| 14  | R7: 5-Locale i18n Symmetry & Zero Hardcoded Copy      | Symmetric keys in zh-CN, zh-TW, zh-HK, en-US, ja-JP; eliminate all hardcoded strings in modified components                     | MC        | ORIGINAL_REQUEST §R7  |
| 15  | R7: Typecheck & Full Verification Gate                | pnpm build passes with zero TS errors; unit and E2E tests verified                                                              | MC        | ORIGINAL_REQUEST §AC7 |

## Milestones

| #   | Name                                       | Scope                                                                                                                                                                                    | Dependencies | Status |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| MA  | Core Protocol, P2P IP & AudioMixer Cleanup | R1, R4 types/service, R5 full cleanup, unit test: packages/types, ipClassifier.ts, VoiceMeshManager.ts, audioMixer removal, verify-phase4-full.ts, scripts/test-p2p-ip-classification.ts | none         | DONE   |
| MB  | Voice & Chat UX Modernization              | R2 (Popover bar chart & status bar decouple), R3 (Focused video aspect ratio), R4 (NetworkQualityModal direct IP), R6 (ImageAttachment shimmer & LightboxModal radial progress)          | MA           | DONE   |
| MC  | i18n 5-Locale Symmetry, Full Build & Gate  | R7 5-locale keys symmetry, zero hardcoded Chinese, pnpm build zero errors, Playwright E2E verification, Forensic Audit                                                                   | MA, MB       | DONE   |

## Interface Contracts

### packages/types ↔ apps/web (PeerLatencyReport)

```ts
export interface PeerLatencyReport {
  targetUserId: string;
  rtt: number;
  jitter?: number;
  packetLoss?: number;
  connectionType: "LAN" | "P2P" | "RELAY" | "SFU";
  status: "connecting" | "connected" | "failed";
  localAddress?: string;
  remoteAddress?: string;
  candidateType?: string;
  updatedAt: number;
}
```

### ipClassifier ↔ VoiceMeshManager

```ts
export function classifyIp(
  ip: string,
):
  | "private-v4"
  | "public-v4"
  | "ula-v6"
  | "link-local-v6"
  | "loopback"
  | "public-v6"
  | "unknown";
export function determineP2PConnectionType(
  localIp: string | undefined,
  remoteIp: string | undefined,
  localCandidateType: string | undefined,
  remoteCandidateType: string | undefined,
): "LAN" | "P2P" | "RELAY";
```

## Code Layout

- `packages/types/src/index.ts` — Shared types & interfaces
- `apps/web/src/services/p2p/ipClassifier.ts` — Hardened IP classification logic
- `apps/web/src/services/p2p/VoiceMeshManager.ts` — P2P stats and connection type
- `apps/server/src/verify-phase4-full.ts` — Updated test
- `apps/web/src/components/voice/VoiceConnectionStatusPopover.tsx` — P2P latency popover & bar chart
- `apps/web/src/components/ChannelSidebar.tsx` — Bottom-left voice status bar & channel navigation
- `apps/web/src/components/VoiceRoomArea.tsx` — Focused video aspect ratio & audio mixer button cleanup
- `apps/web/src/components/modals/NetworkQualityModal.tsx` — P2P peer local/remote IP display
- `apps/web/src/components/chat/ImageAttachment.tsx` — Shimmer skeleton & fade-in
- `apps/web/src/components/chat/LightboxModal.tsx` — Radial progress & HD badge
- `apps/web/src/i18n/locales/{zh-CN,zh-TW,zh-HK,en-US,ja-JP}/*.json` — Symmetric locale keys
- `scripts/test-p2p-ip-classification.ts` — Node test runner for IP classification
