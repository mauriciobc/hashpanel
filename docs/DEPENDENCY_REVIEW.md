# Dependency Review

Evaluation of the two heavier third-party dependencies flagged in `IMPROVEMENT_PLAN.md`.
Both are **recommendations / spike results**, not migrations yet — each should land as its own
PR with output/behaviour verification.

## `canvas` → `@napi-rs/canvas`

**Why it's flagged.** `canvas` is a native Node addon, so the Dockerfile must install a full
build toolchain (`python3 make g++ build-base pkgconf cairo-dev pango-dev libjpeg-turbo-dev
giflib-dev pixman-dev`) in the builder stage and runtime libs (`cairo pango pixman
libjpeg-turbo giflib fontconfig ttf-dejavu`) in the runtime stage. It also rebuilds from source,
which slows CI and makes the image larger.

**Alternative.** `@napi-rs/canvas` ships prebuilt binaries (N-API), needs **no system libraries**,
and exposes a largely compatible API (`createCanvas`, `loadImage`, `GlobalFonts.registerFont`).

**Recommendation.**
1. Spike in a branch: swap the import in `src/services/imageGenerator.js`, map the small API
   differences (`registerFont` vs `GlobalFonts.registerFont`; font registration).
2. Re-generate the dashboard PNG for both themes and diff visually (it is a fixed 800x800 layout,
   so output should be near-identical; emoji/font rendering is the main risk — the image uses
   `font-noto-emoji`).
3. If output matches, drop the native build toolchain from the Dockerfile and rebuild the image.

**Risk.** Emoji/CJK glyph coverage depends on the font set available; verify ALT text and the four
dashboard cards render correctly before removing `canvas`.

## `moment-timezone` → `luxon` (or `Temporal`)

**Why it's flagged.** `moment`/`moment-timezone` are in maintenance mode; `luxon` is the
maintenance-free successor and `Temporal` is the long-term platform answer.

**Affected files.** `src/services/dataProcessor.js`, `src/services/hashtagService.js`,
`src/services/databaseService.js`, `src/utils/timezone.js`, `src/cli/*`, and the data utilities
under `scripts/`.

**Recommendation.**
1. Keep `src/utils/timezone.js` as the single seam; add/extend tests (there is already
   `tests/unit/utils/timezone.test.js`) that pin the "today"/timeframe boundary behaviour.
2. Migrate call sites incrementally to `luxon` (`DateTime.now().setZone(tz)`), behind the existing
   helpers, so behaviour is covered by tests as you go.
3. Only consider `Temporal` once it is stable in the supported Node LTS.

**Risk.** Date/timeframe boundaries are user-visible (the "daily hashtag" and "today" counts).
Do **not** do this as part of a larger refactor — keep it isolated and test-first.

## Other

- `mastodon-api` is used mainly for client construction; most calls already go through `fetch`.
  A future cleanup could drop it, but it is low priority.
