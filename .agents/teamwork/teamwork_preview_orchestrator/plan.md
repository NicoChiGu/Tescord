# Project Plan: Tescord P2P Metrics, Media Adaptive & Image UX Refactor

## Objectives

1. R1: P2P LAN recognition algorithm fix & public IPv6 classification (RFC 1918 / RFC 4193 / Link-Local / Loopback vs 2000::/3 P2P) + unit tests.
2. R2: VoiceConnectionStatusPopover P2P dynamic metrics (avg RTT, packet loss, latency bar chart with avatars & ms labels, health colors, hover jitter/loss) + bottom-left status bar decouple (remove median text, click channel -> stage, click icon -> popover).
3. R3: VoiceRoomArea focus mode dynamic aspect ratio based on videoWidth/videoHeight, remove hardcoded aspect-video and black background, viewport elasticity.
4. R4: PeerLatencyReport interface expansion (localAddress, remoteAddress, candidateType) in packages/types, VoiceMeshManager extraction, NetworkQualityModal direct IP display.
5. R5: Completely remove audioMixer.ts, types AudioMixerConfig/computeMixGains, VoiceRoomArea button & modal, verify native screen share audio unaffected.
6. R6: ImageAttachment shimmering skeleton + smooth fade-in; LightboxModal centered frosted glass radial progress with size/percent, cross-fade to HD + badge.
7. R7: 5-locale i18n full symmetry (zh-CN, zh-TW, zh-HK, en-US, ja-JP), zero hardcoded strings, AGENTS.md compliance, pnpm build TS zero errors, tests passing.

## Milestones & Phasing

- **Phase 0: Survey & Scope Mapping**
  - Dispatch 3 parallel Explorers:
    - Explorer 1: P2P Network, IP classification, WebRTC stats & Popover/Status bar (R1, R2, R4)
    - Explorer 2: Media focus aspect ratio, AudioMixer removal & screen share integrity (R3, R5)
    - Explorer 3: Image attachment shimmer, LightboxModal UX, i18n locales & E2E coverage (R6, R7)
  - Synthesize reports into `PROJECT.md` (Feature Inventory, Architecture, Code Layout, Interface Contracts).
- **Phase 1: Implementation Milestones**
  - Milestone 1: P2P IP Classification & WebRTC Candidate Address Reporting (R1, R4)
  - Milestone 2: Voice Connection Popover & Bottom-left Status Bar & Focus Aspect Ratio (R2, R3)
  - Milestone 3: Audio Mixer Complete Cleanup (R5)
  - Milestone 4: Image Loading Shimmer & LightboxModal Radial Progress (R6)
- **Phase 2: E2E & Hardening Track**
  - E2E Test Suite Creation & Execution
  - 5-locale i18n Symmetry Verification (R7)
  - Build & TypeScript Type Checking (`pnpm build`)
- **Phase 3: Forensic Audit & Victory Claim**
  - Forensic Auditor (teamwork_preview_auditor) Clean Verification
  - Report to Project Sentinel
