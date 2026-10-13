# HashPanel — Codebase Review & Improvement Plan

> Status: **proposed / not yet implemented**
> Review date: 2026-10-13
> Scope: full repository (`src/`, `tests/`, `public/`, Docker, scripts, docs, git hygiene)

This document captures a review of the HashPanel codebase and a phased plan to improve it.
It is intentionally concrete: each finding points at the file(s) and evidence, and each task is
small enough to land as a reviewable change.

---

## 1. Overview

**HashPanel** (npm package `hashbot2`) is a Node.js ESM application that:

- monitors day-of-week Mastodon hashtags (e.g. `#tercinema`),
- stores historical usage in SQLite (`better-sqlite3`),
- serves a web dashboard + REST API (Express),
- generates dashboard PNGs (canvas) with accessible ALT text,
- runs an automatic mention-responding bot over the Mastodon streaming WebSocket.

Approximate size: ~10,978 LOC under `src/`, plus a single 5,173-line `public/index.html`.

### Stack

Node.js (ES Modules) · Express · better-sqlite3 · winston · canvas · zod · node-cache ·
moment-timezone · vitest · eslint + prettier · Docker (Alpine) + optional Portainer/Caddy.

---

## 2. Health snapshot

| Signal | Result | Notes |
|---|---|---|
| `npm test` | ❌ 1 of 99 failing | `hashtagListener.test.js` → `extractHashtags` digits bug |
| `npm run lint` | ❌ 8 errors, 93 warnings | non-zero exit → lint gate red |
| Test suite | 7 files, ~1,721 LOC | no route / integration tests |
| Git hygiene | ⚠️ issues | tracked log files + `scripts/Untitled` |
| CI | ❌ none | `.github/` only holds `copilot-instructions.md` |
| Working tree | ⚠️ 3 modified files | includes an uncommitted Portainer compose rewrite |

---

## 3. Strengths (keep these)

- Clear service-oriented layout; business logic lives in `src/services/`, routes stay thin.
- **All SQL uses prepared statements** — no injection found during review.
- Custom error hierarchy (`src/errors/index.js`) + centralized Express error handler.
- Zod-based env validation with Docker-friendly diagnostics (`src/config/index.js`).
- Structured logging (winston), graceful shutdown, `/health`, rate limiting, compression.
- Accessibility work on generated images (structured ALT text, WCAG 2.1 AA intent).

---

## 4. Findings

### 🔴 Critical

**C1. Hardcoded telemetry that ignores its own configuration**
`src/utils/telemetry.js` posts to a hardcoded endpoint
(`https://telemetry.hashpanel.com/ingest/f426892d-...`, and `http://127.0.0.1:7246/...` in dev),
and is invoked ~39 times with `hypothesisId` / line-number `location` fields
(`src/server/index.js`, `src/services/mastodon.js`, `src/services/hashtagService.js`,
`src/database/index.js`). It **ignores `TELEMETRY_ENDPOINT`** documented in `.env.example`/README.
It fires on every `/health` (Docker polls every 30s), generating constant outbound traffic.
This looks like leftover debug instrumentation and is a privacy/reliability liability.

**Decision (agreed): make it opt-in and config-driven.** Keep the capability but:
- honor `TELEMETRY_ENDPOINT` (default: **disabled** when unset),
- honor `DISABLE_TELEMETRY`,
- reduce to a small number of meaningful events (drop `hypothesisId`/line `location` debug fields),
- never fire from the health check hot path.

**C2. Uncommitted `docker-compose.portainer.yml` rewrite is risky**
The working-tree version runs `node:22-alpine` as `root` with `network_mode: host`, `apk add`s a
build toolchain at boot, `git clone`s from GitHub on every start, mounts the whole app into a
volume (`hashpanel_data:/app`), and sets `CORS_ORIGIN='*'`. This defeats the reproducible
Dockerfile build and is a security/availability concern.

**C3. Failing test = real bug**
`extractHashtags` (`src/services/hashtagListener.js:531`) uses `/#([\w\u00C0-\u024F\u1E00-\u1EFF]+)/gi`
which accepts `#123`. The test expects digit-only tags to be rejected. Fix: require at least one
letter (e.g. `/#(?=[\w...]*[^\W\d_])[\w...]+/` or a post-check filter).

### 🟠 High

**H1. Lint is red.** 8 errors (single-quote rule) in `hashtagListener.js`, `imageGenerator.js`,
`telemetryService.js`; 93 warnings (mostly `no-unused-vars`). `eslint --fix` clears most.

**H2. No CI.** Nothing runs lint/tests on push/PR.

**H3. Committed build artifacts.** Tracked despite `.gitignore`:
`logs/combined.log`, `logs/error.log`, `logs/exceptions.log`, `logs/rejections.log`,
`logs/cron-collect-2025-12-29.log`, `scripts/Untitled`.
Also `.gitignore` ignores `*.md` (except `README.md`) — this silently hides documentation,
including this plan file.

**H4. Dead / placeholder code.** Unused `validatedTimezone` (`src/server/routes/dashboard.js:51,116,167,264`),
`getRequestStats()` stub + `mastodon: 'unknown'` (`src/server/index.js:501,221`),
unused imports (`next`, `config`, `RateLimitError`, `moment`), `cleanupInterval` (`src/middleware/rateLimiter.js:182`).

### 🟡 Medium

**M1. Documentation drift.** README documents `/api/dashboard-data`, `/api/hashtag-stats`,
`/api/top-toots`, `/api/trending-tags`; code actually mounts `/api/dashboard/*`, `/api/hashtag/*`,
`/api/trending`, `/api/toot`. `src/server/routes/index.js:25` advertises `/api/docs` which does not exist.
README promises a `TELEMETRY_ENDPOINT` override that the code ignores (see C1).

**M2. Monolithic frontend.** `public/index.html` = 1,726 lines inline CSS + 3,142 lines inline JS.
Hard to review/test; split into `styles.css` + ES modules.

**M3. Entrypoint naming / `npm start` semantics.** `main: server-new.js`, but `npm start` runs the
CLI while `npm run server` runs the server. Rename `server-new.js` and make `npm start` start the server.

**M4. Expensive health check.** `/health` performs a live Mastodon API call on every request; cached
briefly (30–60s TTL) it would be far cheaper under 30s Docker polling.

**M5. Root-level clutter & duplication.** 11 shell scripts (~1,985 lines) incl. four overlapping
installers and three caddy scripts; loose root JS utilities (`clear-database.js`, `create-test-data.js`,
`diagnose-collection.js`, `test-weekly-history.js`). Empty `docs/` directory.

### 🟢 Low

**L1.** `moment-timezone` is maintenance-mode (migration candidate); `canvas` is a heavy native dep
(consider `@napi-rs/canvas`).
**L2.** `engines` says `node >=18`; README says 21+; Docker uses 22. Align.
**L3.** `.env.example`/README omit `DISABLE_TELEMETRY`, `MEDIA_PROXY_*`, `HEALTHCHECK_TIMEOUT_MS`.
**L4.** Optional `jsonwebtoken` dynamic import in `src/middleware/errorHandler.js` for a JWT flow
that does not appear to exist.

---

## 5. Improvement plan

### Phase 0 — Quick wins (hours, low risk)
- [ ] `eslint --fix` + resolve remaining lint errors → `npm run lint` green.
- [ ] `git rm --cached` tracked log files and `scripts/Untitled`; fix `.gitignore`
      (`*.md` rule → allow `docs/**`, or drop the blanket ignore).
- [ ] Remove dead code / unused vars (H4).
- [ ] Fix `extractHashtags` (C3); add edge-case tests (`#`, `#a`, `#123`, unicode, duplicates).
- [ ] Correct README endpoint list; drop the phantom `/api/docs` reference.

### Phase 1 — Security & correctness
- [ ] Telemetry: remove hardcoded endpoint + `hypothesisId`/line-noise; honor `TELEMETRY_ENDPOINT`,
      default off when unset; stop firing from `/health` (C1).
- [ ] Revert/rework `docker-compose.portainer.yml` to a pinned, non-root, non-`network_mode: host`
      design consistent with `docker-compose.yml` (C2).
- [ ] Cache the health check's Mastodon probe (30–60s TTL) (M4).
- [ ] `npm start` → server; rename `server-new.js` and fix `main` (M3).

### Phase 2 — Quality & structure
- [ ] Add GitHub Actions CI: install → `lint` → `test` (with coverage threshold) (H2).
- [ ] Add integration tests for routes + `/health` using supertest (already a devDependency);
      raise coverage toward ≥70%.
- [ ] Split `public/index.html` into `styles.css` + JS modules (M2).
- [ ] Consolidate root scripts into `scripts/` (one installer, one cron helper); document/delete the rest (M5).
- [ ] Unify the two compose files; keep healthcheck + resource limits in one place.

### Phase 3 — Polish
- [ ] Evaluate `@napi-rs/canvas` (L1).
- [ ] Plan `moment-timezone` → `luxon`/`Temporal` (low priority).
- [ ] Add OpenAPI/Swagger for the real routes; populate `docs/`.
- [ ] Align Node version across README / Docker / `package.json` (L2).
- [ ] Document remaining env vars (L3); remove or justify the `jsonwebtoken` import (L4).

---

## 6. Suggested first PR (highest leverage, lowest risk)

One PR that:
1. makes lint green (`eslint --fix` + remaining errors),
2. untracks the log files & `scripts/Untitled` and fixes `.gitignore`,
3. fixes the `extractHashtags` bug + tests,
4. makes telemetry opt-in / config-driven and removes it from the health path,
5. fixes README endpoints.

This removes the only failing test, the only failing gate, the telemetry/privacy concern, and the
doc drift in a single reviewable change.

---

## 7. Definition of done (per task)

- `npm test` green and `npm run lint` green.
- No new `no-unused-vars` warnings.
- Behavior changes covered by a test where practical.
- No secrets or generated artifacts added to git.
