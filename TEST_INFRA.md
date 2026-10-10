# E2E Test Infra: Tescord P2P Metrics, Media Adaptive & Image UX

## Test Philosophy

- Opaque-box, requirement-driven. Derived from ORIGINAL_REQUEST.md.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise + Workload Testing.

## Feature Inventory

| #   | Feature                                          | Source               | Tier 1 | Tier 2 | Tier 3 |
| --- | ------------------------------------------------ | -------------------- | :----: | :----: | :----: |
| 1   | R1: IP Classifier & LAN/P2P Detection            | ORIGINAL_REQUEST §R1 |   5    |   5    |   ✓    |
| 2   | R2: Voice Popover P2P Metrics & Bar Chart        | ORIGINAL_REQUEST §R2 |   5    |   5    |   ✓    |
| 3   | R2: Bottom-left Voice Status Bar Decouple        | ORIGINAL_REQUEST §R2 |   5    |   5    |   ✓    |
| 4   | R3: Voice Focused Video Aspect Ratio Adaptive    | ORIGINAL_REQUEST §R3 |   5    |   5    |   ✓    |
| 5   | R4: Network Quality Modal Direct IP Display      | ORIGINAL_REQUEST §R4 |   5    |   5    |   ✓    |
| 6   | R5: Audio Mixer Complete Cleanup                 | ORIGINAL_REQUEST §R5 |   5    |   5    |   ✓    |
| 7   | R6: Chat Image Shimmer Skeleton & Fade-in        | ORIGINAL_REQUEST §R6 |   5    |   5    |   ✓    |
| 8   | R6: Lightbox Radial Progress & HD Badge          | ORIGINAL_REQUEST §R6 |   5    |   5    |   ✓    |
| 9   | R7: 5-Locale i18n Symmetry & Zero Hardcoded Copy | ORIGINAL_REQUEST §R7 |   5    |   5    |   ✓    |

## Test Architecture

- Unit Tests: `scripts/test-p2p-ip-classification.ts` using `node:test` + `node:assert/strict`. Run via `pnpm tsx scripts/test-p2p-ip-classification.ts`.
- E2E Tests: Playwright suite in `e2e/`:
  - `e2e/chat-image-skeleton.spec.ts`
  - `e2e/lightbox-interaction-and-download.spec.ts`
  - Voice connection popover & bottom-left status bar navigation specs
- Build & Typecheck Gate: `pnpm build` across all workspaces (`packages/types`, `apps/web`, `apps/desktop`, `apps/server`).

## Coverage Thresholds

- Tier 1: ≥5 per feature
- Tier 2: ≥5 per feature (where boundaries exist)
- Tier 3: Pairwise coverage of major feature interactions
- Tier 4: Realistic end-to-end user scenarios
