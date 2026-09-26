# Cloudflare SFU/TURN release acceptance (2026-09-27)

Production target: `tera@100.69.12.101`, `https://tescord.terata.top`, rootless Podman with `docker/docker-compose-cloudflare.yml`. Deployed application code: `c323a596a37e9a903c313204e5bcf55443768dd9`. The Web and server application images were replaced; PostgreSQL, Redis, MinIO, tunnel configuration, and persistent volumes were retained. There were no Prisma schema changes or pending migrations.

Before deployment, PostgreSQL and MinIO backups were saved under `/home/tera/tescord-backups/2026-09-27-codex-release/`. PostgreSQL backup SHA-256: `c9e64b44278959c92cdcf403291c0a3debde2c3ecf69d6aa565781111c9c7530`; MinIO backup SHA-256: `0da0e2bf24ebace27733c7420bbc762189b4833fe9e9ff8913d30e94f770a8e9`. PostgreSQL restore was checked in an isolated temporary container (89 tables). The previous application images are tagged `localhost/tescord-server:rollback-20260927` and `localhost/tescord-web:rollback-20260927`.

## Local verification

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm build` | 4/4 packages passed | [local-build.log](local-build.log) |
| `pnpm test:e2e` | 171/171 Playwright tests passed | [local-e2e.log](local-e2e.log) |
| `pnpm test:security-media` | media crypto checks passed | [local-security-media.log](local-security-media.log) |
| `pnpm exec playwright test e2e/camera-live-stream.spec.ts e2e/cloudflare-media-security.spec.ts` | 4/4 passed after the final media change | Console output captured during the release run |
| `BUILD_TARGET=desktop pnpm --filter @tescord/web build`, then `pnpm test:e2e:electron` | Desktop Web build passed; `file://` session test 1/1 passed, packaged-shell test 1 skipped | [desktop build](local-desktop-build.log), [Electron E2E](local-electron-e2e.log) |

The packaged-shell test was skipped because no packaged installer was available.

## Production media verification

`e2e-real/cloudflare-live-media.spec.ts` passed once with automatic ICE selection and once with `TESCORD_FORCE_RELAY=1` (1/1 each). It used three temporary authorized browser identities and synthetic audio/video capture. The WebRTC path, Cloudflare SFU/TURN and RTP were real; physical microphones, speakers, and capture devices were not part of the test.

The test checked inbound and outbound Opus bytes increasing on all three clients, camera VP8 frames and byte growth, microphone/camera device switches, screen video byte growth and companion audio, viewer count 2 then 1 after stopping one viewer, and no uncaught severe browser console errors. The relay run selected relay candidates for all three clients. Automatic ICE selected peer-reflexive candidates on two clients and relay on one. [TURN media stats](turn-relay-media-stats.json), [automatic ICE media stats](auto-ice-media-stats.json), [TURN receiver screenshot](turn-relay-receiver.png), and [automatic ICE receiver screenshot](auto-ice-receiver.png) preserve the evidence. The receiver screenshot shows one viewer after the second viewer stopped.

After each run, the acceptance cleanup script removed the three exact account IDs, one guild ID and one registration-invite code; it reported zero remaining users, guilds and invites for those IDs. No existing business data was modified for acceptance.

Final read-only checks: all five application/data containers healthy; `/healthz` and `/` returned 200; the ONNX `.mjs` returned 200 `application/javascript`, `.wasm` returned 200 `application/wasm`, a nonexistent `.mjs` returned 404, and anonymous `/api/guilds` returned 401.

Network interruption recovery, a live server restart, physical device audio level, and a packaged Electron installer were not covered by the production browser run. The test has optional recovery branches, but they were not enabled during this release.
