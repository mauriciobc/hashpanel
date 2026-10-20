# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: community members of a Brazilian Mastodon instance ("mauriciojunca" communities) who participate in day-of-week hashtags (e.g. `#tercinema`, `#tercinéfilo`). They visit the dashboard to see how the daily hashtag is trending and to find active, relevant posts worth engaging with.

Secondary (confirmed by usage, not targeted by design): the owner, who uses the same dashboard to monitor collection health and community participation.

## Product Purpose

HashPanel monitors Mastodon hashtags assigned to days of the week, collects historical usage data (SQLite), and presents trends, top posts, and weekly history on a public web dashboard. It also publishes daily summary posts and responds to mentions with reports via an automatic bot. Success means community members can, at a glance, see today's hashtag activity and decide to participate.

## Positioning

A community-owned stat panel for recurring Portuguese-language Mastodon hashtags: it combines ranked post relevance (by interactions and follower counts of the authors) with weekly historical trend charts, and it publishes its insight back into the network itself via bot posts with accessible images — not just a passive analytics page.

## Operating Context

- Data source: Mastodon API (streaming WebSocket for mentions; REST for hashtag timelines); day-of-week hashtag schedule
- Runs `npm run dev` / `node server-new.js`; collects via cron jobs; daily CLI workflows (`npm run status`, `npm run analyze`)
- Deployment: self-hosted on the owner's own server via Docker, publicly reachable by URL (Caddy available as reverse proxy)
- Mixed consumption: desktop and mobile; users often arrive from Mastodon bot posts linking to images and the dashboard

## Capabilities and Constraints

- Dashboard: daily stats, weekly history charts, top/relevance-ranked posts, image proxy for media (CORS)
- REST API endpoints; `/health`; rate limiting; structured logging (winston)
- Bot: replies to mentions with a report; generates dashboard PNG images (canvas) with detailed ALT descriptions
- Existing WCAG 2.1 AA intent on generated images must be preserved and extended
- Data in SQLite (better-sqlite3); config validated with zod; i18n: user-facing content is Brazilian Portuguese (`lang="pt-BR"`); all UI copy stays in pt-BR
- Node.js ESM, no frontend framework: the dashboard is one large `public/index.html` (vanilla JS + Bootstrap CSS + Chart.js + Inter)
- Docker-based deployment; ~11k LOC under `src/`

## Brand Commitments

- Name: "Hashpanel" (npm package `hashbot2` is internal; do not surface)
- All user-facing copy in pt-BR
- Voice: community-oriented, helpful, accessible — an invitation to participate in the daily hashtags, not a corporate analytics product

## Evidence on Hand

- Real production data: SQLite history with weekly records; current charts and top posts live in `public/index.html`
- Generated dashboard images and their structured ALT text in `src/services` (image generation pipeline)
- Existing Incubate/critique artifacts in `.impeccable/critique/` (screenshot-based review of `public/index.html`)
- No testimonials, press, or case studies — do not fabricate any

## Product Principles

1. **Glanceable in five seconds** — a community member arrives, sees today's hashtag state, and acts (posts, boosts, clicks through to a post).
2. **Accessibility is a feature, not a checkbox** — full UI targets WCAG 2.1 AA; generated images keep detailed ALT text.
3. **Community-facing warmth** — speak to participants in pt-BR, celebrating participation rather than auditing it.
4. **Trust through honesty** — show real data from the collection pipeline; empty states state their cause (e.g., "coleta ainda não rodou hoje") instead of faking content.

## Accessibility & Inclusion

- Required standard: WCAG 2.1 AA across the entire dashboard (confirmed by the owner), including contrast on the current dark backgrounds, focus visibility, keyboard navigation, and named/reduced-motion support — extending the existing ALT-text work on generated images.
- Primary audience reads pt-BR; screen reader support is part of AA compliance.

## Open Decisions

- Whether the bot's published image themes should visually match the dashboard's future design language (undecided; do not assume).
