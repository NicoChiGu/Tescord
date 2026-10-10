# E2E Test Suite Ready

## Test Runner

- Unit & IP Test: `pnpm --filter @tescord/server exec tsx ../../scripts/test-p2p-ip-classification.ts`
- E2E Playwright Tests:
  - `pnpm exec playwright test e2e/chat-image-skeleton.spec.ts e2e/lightbox-interaction-and-download.spec.ts e2e/i18n-language-switch.spec.ts`
  - `pnpm exec playwright test e2e/live-streaming-and-connection-popover.spec.ts`
- Expected: All tests pass with exit code 0.

## Coverage Summary

| Tier                      |   Count | Description                                                                            |
| ------------------------- | ------: | -------------------------------------------------------------------------------------- |
| 1. Feature Coverage       |      45 | Tests covering R1-R7 happy paths and isolated features                                 |
| 2. Boundary & Corner      |      45 | Tests covering abnormal IPs, 0 latency, missing candidate pairs, extreme aspect ratios |
| 3. Cross-Feature          |      12 | Pairwise coverage across P2P latency updates, Popover charts, Lightbox HD download     |
| 4. Real-World Application |      12 | Multi-peer mesh simulation, language hot-swapping, video focus switching               |
| **Total**                 | **114** |                                                                                        |

## Feature Checklist

| Feature                                     | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
| ------------------------------------------- | :----: | :----: | :----: | :----: |
| R1: P2P LAN/IPv6 IP Classification          |   5    |   5    |   ✓    |   ✓    |
| R2: Voice Popover & Status Decouple         |   5    |   5    |   ✓    |   ✓    |
| R3: Video Focus Aspect Ratio Adaptive       |   5    |   5    |   ✓    |   ✓    |
| R4: Network Quality Modal Direct IP         |   5    |   5    |   ✓    |   ✓    |
| R5: Audio Mixer Complete Cleanup            |   5    |   5    |   ✓    |   ✓    |
| R6: Image Shimmer & Lightbox Radial HD      |   5    |   5    |   ✓    |   ✓    |
| R7: 5-Locale i18n Symmetry & Zero Hardcoded |   5    |   5    |   ✓    |   ✓    |
| Global Build TS 0 Errors                    |   5    |   5    |   ✓    |   ✓    |
| Security & Bounds Verification              |   5    |   5    |   ✓    |   ✓    |
