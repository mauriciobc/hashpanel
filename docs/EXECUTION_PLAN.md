# HashPanel — Execution Plan (how to address every item in IMPROVEMENT_PLAN.md)

> Companion to `docs/IMPROVEMENT_PLAN.md`.
> Status: **planned / not yet implemented**
> Worktree: `improvement-plan` (currently **detached HEAD** at `dc586b5`)

This document turns each item in `IMPROVEMENT_PLAN.md` into concrete, reviewable work.
Work is grouped into **PR-sized workstreams (WS-1 … WS-12)**. Every Critical/High/Medium/Low
finding and every Phase 0–3 checkbox is mapped to exactly one workstream (see §3 traceability).

---

## 0. Ground rules & prerequisites

Before any PR:

1. **Create a branch** — the worktree is in detached HEAD. Either one long branch
   (`chore/improvement-plan`) or one branch per WS (`fix/lint-hygiene`, `feat/telemetry-optin`, …).
   Recommended: one branch per WS so each is independently reviewable.
2. **Install deps in the worktree** (`npm ci`) — it is a clean checkout with no `node_modules`.
3. **Establish a baseline**: record `npm test` and `npm run lint` output at HEAD so each PR's
   delta is measured (not the whole backlog).
4. **`.gitignore` ignores `*.md`** (except `README.md`). That is itself finding H3; WS-1 fixes it.
   Until then, this plan and `IMPROVEMENT_PLAN.md` are untracked by design.
5. Keep the repo's conventions: ES Modules, JSDoc comments, `loggers` from `src/utils/logger.js`,
   custom errors from `src/errors/index.js`, prepared statements only.

---

## 1. Workstreams

Each workstream lists: **addresses → files → steps → verification → risk/rollback**.

### WS-1 — Repo hygiene & green lint  *(Phase 0)*
**Addresses:** H1, H3, part of H4.

**Files:** `.gitignore`, `src/services/hashtagListener.js`, `src/services/imageGenerator.js`,
`src/services/telemetryService.js`, all files flagged by `no-unused-vars`, `logs/*` (index only),
`scripts/Untitled` (delete).

**Steps**
1. `npx eslint src --fix` to auto-fix the 8 single-quote errors.
2. Fix remaining errors by hand if `--fix` misses any; confirm `npm run lint` exits 0.
3. Remove unused symbols (H4 subset): `next` (`errorHandler.js`), `config` + `RateLimitError` +
   `cleanupInterval` (`src/middleware/rateLimiter.js`), unused `moment` import
   (`src/utils/validators.js`), unused `config` (`src/utils/telemetry.js` — resolved fully in WS-3).
4. `git rm --cached logs/combined.log logs/error.log logs/exceptions.log logs/rejections.log
   logs/cron-collect-2025-12-29.log` and `git rm scripts/Untitled`.
5. `.gitignore`: replace the blanket `*.md` with `!docs/**/*.md` (or drop it), and add
   `scripts/Untitled`-style temp guards if needed.

**Verification:** `npm run lint` → 0 problems; `git status` no longer lists logs; plan docs become
trackable; `npm test` still 98/99 (WS-2 fixes the last one).

**Risk:** trivial. `git rm --cached` keeps files on disk.

---

### WS-2 — Fix hashtag extraction bug  *(Phase 0, C3)*
**Addresses:** C3.

**Files:** `src/services/hashtagListener.js` (`extractHashtags`, ~line 531),
`tests/unit/services/hashtagListener.test.js`.

**Steps**
1. Change the plain-text regex so a tag must contain at least one letter (digits-only rejected),
   while still allowing Unicode (e.g. require a leading letter or a lookahead for `[^\W\d_]`):
   `/#(?=[\p{L}\p{N}_]*[\p{L}])[\p{L}\p{N}_]+/gu` (or keep the existing ranges + a post-filter).
2. Keep the Mastodon `<a class="hashtag">#<span>…</span></a>` path as the authoritative branch.
3. Add edge-case tests: `#` alone, `#a`, `#123`, `#a1`, `#músicabrasileira`, duplicates,
   emoji-adjacent.

**Verification:** `npm test` → 99/99 green.

**Risk:** low. Only affects mention parsing; add regression tests.

---

### WS-3 — Telemetry: opt-in & config-driven  *(Phase 1, C1)*
**Addresses:** C1, part of L3.

**Decision (agreed):** keep the capability, default **off**, drive it from config.

**Files:** `src/utils/telemetry.js`, `src/config/index.js`, `src/server/index.js`,
`src/services/mastodon.js`, `src/services/hashtagService.js`, `src/database/index.js`,
`.env.example`, `README.md`, `.github/copilot-instructions.md` (line 36).

**Steps**
1. Rewrite `sendTelemetry` to:
   - no-op unless `TELEMETRY_ENDPOINT` is set (from `appConfig.telemetry.endpoint`) **and**
     not `DISABLE_TELEMETRY === 'true'`;
   - remove the hardcoded `telemetry.hashpanel.com` / `127.0.0.1:7246` endpoints and the
     hardcoded ingest token;
   - drop debug-only `hypothesisId` and `location` (line-number) payload fields;
   - keep fire-and-forget with internal try/catch.
2. Remove/adjust the ~39 call sites:
   - **Delete all telemetry calls from the `/health` handler** (`src/server/index.js`) — it must
     not do outbound I/O on the 30s Docker poll.
   - Collapse the noisy per-step calls in `mastodon.js` / `hashtagService.js` / `database/index.js`
     to a few meaningful events (or remove).
3. `src/config/index.js`: make `TELEMETRY_ENDPOINT` optional and pass through unchanged (already
   optional); ensure `appConfig.telemetry.endpoint` is the single source of truth.
4. Docs: update `.env.example` + README telemetry section to state default-off, the env vars, and
   what is sent.

**Verification:** with no `TELEMETRY_ENDPOINT`, `grep -r "hashpanel.com"` returns nothing and no
outbound requests occur; `npm test` green.

**Risk:** medium (touches many files) but behavior-preserving since telemetry is fire-and-forget.
Land alone, review `git diff` call-site by call-site.

---

### WS-4 — Docker / Portainer hardening  *(Phase 1, C2 + part of M5)*
**Addresses:** C2, unify-compose (Phase 2 M5).

**Files:** `docker-compose.portainer.yml` (revert/rewrite), `docker-compose.portainer.simple.yml`,
`docker-compose.yml`, `Dockerfile`.

**Steps**
1. Discard the uncommitted `git clone`-at-boot rewrite. Base the Portainer file on the **committed**
   version that uses `build: { context: ., dockerfile: Dockerfile }`.
2. Remove `network_mode: host`, `user: root`, runtime `apk add`, and `CORS_ORIGIN=*` default;
   keep the bridge network + named data/log volumes + `env_file`.
3. Keep resource limits + a healthcheck (align with `docker-compose.yml`).
4. Decide the fate of `docker-compose.portainer.simple.yml`: either align it to the same
   build-based, non-root model or mark it explicitly "legacy/unsupported" and delete it.
5. Add a short note to README on the supported deployment path (Dockerfile build via compose),
   and on why runtime-clone is unsupported.

**Verification:** `docker compose -f docker-compose.portainer.yml config` parses; container builds
from the Dockerfile and runs as non-root; `/health` reachable on the bridge network.

**Risk:** medium — deployment config. Do not merge without a real `docker compose up` smoke test.

---

### WS-5 — Entrypoint naming & script consolidation  *(Phase 1 M3 + Phase 2 M5)*
**Addresses:** M3, M5.

**Files:** `server-new.js` → `src/server/main.js`; `package.json`; `Dockerfile`;
root scripts (`install*.sh`, `caddy-*.sh`, `install-caddy-*.sh`, `test-alpine-cron.sh`);
`scripts/setup-cron.sh` + `scripts/setup-cron-alpine.sh`;
`scripts/cron-collect-history.sh` + `scripts/cron-collect-history-alpine.sh`;
root JS (`clear-database.js`, `create-test-data.js`, `diagnose-collection.js`,
`test-weekly-history.js`).

**Steps**
1. Rename `server-new.js` → `src/server/main.js`; update `package.json` `main` and all scripts
   (`server`, `dev:server`, `dev:watch`), `Dockerfile` `CMD`, and README references.
2. Make `npm start` launch the **server** (`node src/server/main.js`); expose the current CLI start
   as `npm run report` (or `cli`) and update README.
3. Merge the bash/Alpine duplicate pairs into a single POSIX-`sh` script each
   (`setup-cron.sh`, `cron-collect-history.sh`), since the Docker image is Alpine. Update
   `docker-entrypoint.sh` + `package.json` `cron:*` scripts accordingly.
4. Consolidate install/caddy scripts: keep one installer (`install.sh`) and one Caddy helper;
   move the rest to `scripts/legacy/` or delete with a note; fix references in README.
5. Move root utility JS into `scripts/` and update `package.json` paths
   (`db:clear`, `test:weekly`, `diagnose:collection`).

**Verification:** `npm start` starts the server; `npm run server` still works; cron dry-run
(`npm run cron:test`) works inside the Alpine image; no dangling references (`grep` the old names).

**Risk:** medium — renames ripple through docs/scripts/Docker; grep-verify every reference.

---

### WS-6 — Health-check performance  *(Phase 1 M4)*
**Addresses:** M4.

**Files:** `src/server/index.js` (healthCheck), maybe `src/services/mastodon.js`.

**Steps**
1. Wrap the Mastodon liveness probe in a short-lived cache (e.g. 30–60s TTL) so `/health` at 30s
   polling reuses the last result instead of hitting the API each time.
2. Keep DB + WebSocket checks cheap (already local).
3. Consider using a lightweight endpoint (e.g. `/api/v1/instance`) rather than `getTrendingTags`.

**Verification:** repeated `/health` calls do ≤1 Mastodon request per TTL window (count in logs).

**Risk:** low.

---

### WS-7 — Documentation accuracy  *(Phase 0 M1 + Phase 1/3 L2/L3/L4)*
**Addresses:** M1, L2, L3, L4.

**Files:** `README.md`, `src/server/routes/index.js`, `.env.example`, `package.json` (`engines`),
`src/server/routes/dashboard.js` (dead `validatedTimezone` → part of H4),
`src/middleware/errorHandler.js` (jsonwebtoken import).

**Steps**
1. Replace the stale endpoint list in README (`/api/dashboard-data`, `/api/hashtag-stats`,
   `/api/top-toots`, `/api/trending-tags`) with the real mounts: `/api/dashboard/*`, `/api/hashtag/*`,
   `/api/trending`, `/api/toot`, `/api/media`, `/api/websocket`, `/health`.
2. Remove the phantom `documentation: '/api/docs'` from `src/server/routes/index.js` (or add a real
   docs route in WS-12).
3. Align Node version: pick one (Docker uses 22) and update `package.json` `engines`,
   README requirements, and copilot-instructions if needed.
4. Document remaining env vars in `.env.example` + README (`DISABLE_TELEMETRY`, `MEDIA_PROXY_*`,
   `HEALTHCHECK_TIMEOUT_MS`); see WS-3.
5. Remove `validatedTimezone` dead assignments in `dashboard.js` (or actually use them), and
   remove the optional `jsonwebtoken` import in `errorHandler.js` if no JWT flow exists (confirm first).

**Verification:** every endpoint in README resolves in `src/server/routes/*`; no `/api/docs` link;
`grep validatedTimezone` returns only intentional uses.

**Risk:** low (docs + dead code).

---

### WS-8 — Continuous Integration  *(Phase 2 H2)*
**Addresses:** H2.

**Files:** new `.github/workflows/ci.yml`.

**Steps**
1. Workflow: checkout → `actions/setup-node` (pin the chosen LTS/22) → `npm ci` →
   `npm run lint` → `npm test` (and `test:coverage`).
2. Add a coverage threshold in `vitest.config.js` (`coverage.thresholds`) once WS-9 raises
   coverage; start lenient then tighten.
3. Optionally cache `~/.npm`.
4. Decide enforcement: fail on lint errors; allow coverage to start as a warning.

**Verification:** CI runs green on the PR; intentionally breaking lint/test turns it red.

**Risk:** low.

---

### WS-9 — Integration test coverage  *(Phase 2)*
**Addresses:** Phase 2 "integration tests" + coverage goal.

**Files:** new `tests/integration/*.test.js`; `vitest.config.js`; supertest (already a devDependency).

**Steps**
1. Add integration tests for `/health` (healthy + degraded paths, with Mastodon probe mocked),
   and the main read routes (`/api/dashboard/*`, `/api/hashtag/*`, `/api/trending`, `/api/toot/:id`).
2. Mock `mastodonService` + the DB (temp SQLite file, as `tests/unit/database/index.test.js` does).
3. Raise coverage toward ≥70% and enable the threshold from WS-8.

**Verification:** new tests pass; coverage report increases; threshold enforced.

**Risk:** medium — needs care with singletons (`webServer`, `getDatabase`) between tests.

---

### WS-10 — Frontend decomposition  *(Phase 2 M2)*
**Addresses:** M2.

**Files:** `public/index.html` (1,726 CSS + 3,142 JS inline) → `public/styles.css`,
`public/js/*.js` (ES modules), `public/index.html` (markup only).

**Steps**
1. Extract the inline `<style>` → `public/styles.css` (link it).
2. Split the inline `<script>` into ES modules (api client, formatting, charts, tables,
   timezone handling) under `public/js/`, load with `<script type="module">`.
3. Keep the Chart.js CDN dependency (or vendor it) and preserve current behavior.
4. Verify with the app running (browser smoke test) — no visual/behavioral regressions.

**Verification:** dashboard renders and all cards/tables/charts load; no console errors.

**Risk:** medium — do it mechanically (move-only) first, then refactor in follow-ups.

---

### WS-11 — Dependency modernization  *(Phase 3 L1)*
**Addresses:** L1.

**Files:** `package.json`, `src/services/imageGenerator.js`, `Dockerfile`, any `moment-timezone` users.

**Steps**
1. **Spike:** benchmark `canvas` vs `@napi-rs/canvas` for the dashboard PNG; if it removes the
   native build toolchain from the Dockerfile and output is identical, migrate `imageGenerator.js`.
2. **Spike:** assess `moment-timezone` → `luxon` (or `Temporal` when stable) effort across
   `dataProcessor.js`, `hashtagService.js`, `databaseService.js`, `utils/timezone.js`, `cli/`.
   Do this as an isolated follow-up only if it can be done safely.

**Verification:** image output byte/visually equivalent; timezone tests (`tests/unit/utils/timezone.test.js`)
green; Docker build slimmer.

**Risk:** medium; treat as separate, optional PRs.

---

### WS-12 — API documentation & docs/  *(Phase 3)*
**Addresses:** Phase 3 "OpenAPI/Swagger", populate `docs/`.

**Files:** new `src/server/routes/docs.js` (or `openapi.yaml` + `swagger-ui`), `src/server/routes/index.js`,
`README.md`, `docs/`.

**Steps**
1. Add an OpenAPI 3 spec for the real routes; serve it at `/api/docs` (ties off the WS-7 phantom link).
2. Populate `docs/` (runbooks: deployment, cron, telemetry; link from README).
3. Link architecture notes to `.github/copilot-instructions.md`.

**Verification:** `/api/docs` serves a valid spec covering all mounted routes.

**Risk:** low.

---

## 2. Recommended sequencing

```
WS-1 (hygiene+lint) ──┬─► WS-2 (extractHashtags)
                      ├─► WS-3 (telemetry)
                      ├─► WS-7 (docs accuracy)
                      └─► WS-8 (CI) ──► WS-9 (integration tests)
WS-4 (docker)  ──► WS-5 (entrypoint+scripts)
WS-6 (health perf)  independent
WS-10 (frontend)    independent, after WS-8/9 land for safety
WS-11, WS-12        last, optional
```

Dependency notes:
- Do **WS-1 first** — it unblocks tracking files (`.gitignore`) and gives a green baseline for CI.
- **WS-7** should land before/with **WS-3** so the telemetry docs match the code.
- **WS-8** can land early with a lenient gate, then tighten after **WS-9**.
- **WS-5** must stay consistent with **WS-4** (compose references entrypoint/CMD).

### Suggested first PR (from IMPROVEMENT_PLAN §6) = WS-1 + WS-2 + WS-3 + WS-7
That single batch removes the failing test, makes lint green, fixes the telemetry concern, and
fixes doc drift. If you prefer smaller PRs, split as WS-1, then WS-2, then WS-3+WS-7.

---

## 3. Traceability — every finding maps to a workstream

| Finding | Workstream |
|---|---|
| C1 telemetry hardcoded / ignores config | WS-3 |
| C2 Portainer compose rewrite | WS-4 |
| C3 `extractHashtags` bug | WS-2 |
| H1 lint red | WS-1 |
| H2 no CI | WS-8 |
| H3 committed artifacts + `.gitignore *.md` | WS-1 |
| H4 dead/placeholder code | WS-1 (unused vars) + WS-7 (`validatedTimezone`, jsonwebtoken) |
| M1 documentation drift | WS-7 (+ WS-12 for `/api/docs`) |
| M2 monolithic frontend | WS-10 |
| M3 entrypoint / `npm start` | WS-5 |
| M4 expensive health check | WS-6 |
| M5 root clutter & duplication | WS-4 (compose) + WS-5 (scripts) |
| L1 canvas / moment-timezone | WS-11 |
| L2 Node version alignment | WS-7 |
| L3 undocumented env vars | WS-3 + WS-7 |
| L4 jsonwebtoken import | WS-7 |

Phase checklists:
- **Phase 0** = WS-1, WS-2 (+ parts of WS-7) → ✅ all four checkboxes covered.
- **Phase 1** = WS-3, WS-4, WS-5, WS-6.
- **Phase 2** = WS-8, WS-9, WS-10, WS-4/WS-5 (compose + script unification).
- **Phase 3** = WS-11, WS-12, WS-7.

---

## 4. Definition of done (per workstream)

- `npm run lint` → 0 problems.
- `npm test` green; new behavior covered by a test where practical.
- No secrets or generated artifacts added to git (`git status` clean of `logs/`, `*.db`, `.env`).
- README/docs updated for anything user-visible.
- One focused PR, revertible in isolation.

---

## 5. Implementation status

### Done — first batch (WS-1, WS-2, WS-3, WS-7)

Branches are **stacked** (each based on the previous), so PRs should target the previous
branch, not `main`:

| Workstream | Branch | Commit |
|---|---|---|
| plans | `docs/accuracy` (base) | `docs: add codebase improvement and execution plans` |
| WS-1 lint/hygiene | `fix/lint-hygiene` | `chore: green lint, untrack build artifacts, harden gitignore` |
| WS-2 hashtag bug | `fix/hashtag-extraction` | `fix: reject numeric-only hashtags in mention extraction` |
| WS-3 telemetry | `feat/telemetry-optin` | `feat(telemetry): make telemetry opt-in and config-driven` |
| WS-7 docs | `docs/accuracy` | `docs: fix API/endpoint and environment documentation accuracy` |

Verification at the tip: `eslint src` → 0 problems; `npm test` → 102/102 passing.

### Discovered during implementation (affects later workstreams)

- **Config requires real env vars at import time** (`src/config/index.js` validates
  `MASTODON_URL`/`CLIENT_KEY`/`CLIENT_SECRET`/`ACCESS_TOKEN` eagerly). `npm test` therefore only
  runs with a populated `.env`. **WS-8 (CI) and WS-9 must** either inject dummy env vars in the
  workflow or make config lazy/mockable. This is a prerequisite for CI.
- **Zod v4 API bug** — `src/config/index.js:75` reads `error.errors`, but Zod v4 exposes
  `error.issues`. On invalid config the enhanced diagnostic throws
  `TypeError: Cannot read properties of undefined (reading 'filter')`, masking the real
  validation error (this is exactly what happened when running tests without `.env`). **Not yet
  fixed** — small, self-contained fix; candidate for a follow-up commit before WS-8.
- **`.github/copilot-instructions.md` is not tracked** (git-ignored as `*.md` and never committed).
  If it should be versioned, force-add it and extend the `.gitignore` exception.

### Notes

- The worktree has a symlinked `node_modules` and a copied `.env` — both local-only and ignored.
- WS-4/WS-5 must stay consistent (compose references the entrypoint/`CMD`). WS-10 (frontend) is
  best done after WS-8/WS-9 land.

### Done — remaining workstreams

| Workstream | Branch | Commit summary |
|---|---|---|
| config fix | `fix/config-error-handling` | Zod v4 `error.issues` in the config diagnostic |
| WS-6 health | `perf/healthcheck-cache` | cache the Mastodon health probe (30s) |
| WS-5 entrypoint/scripts | `chore/entrypoint-scripts` | `src/server/main.js`, `npm start` = server, merged cron scripts, moved dev utilities |
| WS-4 docker | `chore/docker-hardening` | removed clone-at-boot compose, dropped obsolete `version:`, added `init`/`no-new-privileges` |
| WS-8 CI | `ci/github-actions` | GitHub Actions (lint + test + coverage), dummy env vars, coverage floor |
| WS-9 tests | `test/integration` | Express middleware + route integration tests; fixed Zod v4 in `errorHandler` |
| WS-10 frontend | `refactor/frontend-split` | split `index.html` (5173→305 lines) into `styles.css` + `js/app.js` |
| WS-12 docs | `docs/openapi` | OpenAPI 3 spec served at `/api/docs` |
| WS-11 deps | `docs/openapi` | `docs/DEPENDENCY_REVIEW.md` (spike results; migrations intentionally left as follow-ups) |

Final baseline at the tip: `eslint src` → 0 problems; `npm test` → 113/113; coverage ~44%
(thresholds enforced). CI was validated locally with no `.env` and dummy env vars.

Still open by design: the actual `canvas`→`@napi-rs/canvas` and `moment`→`luxon` **migrations**
(WS-11) — they need image-output / date-boundary verification and should be separate PRs.

