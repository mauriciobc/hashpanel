---
target: web dashboard + generated report image
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
target_identity: "file:/home/mauriciobc/Documentos/Code/hashpanel/public/index.html"
target_fingerprint: "sha256:73cc4ea3ed033bb5843eedd6421d50fae074c897cde9de6974b75dce27ecf556"
target_path: /home/mauriciobc/Documentos/Code/hashpanel/public/index.html
timestamp: 2026-10-13T18-02-04Z
slug: public-index-html
---
# Design Critique — Hashpanel (public/index.html + src/services/imageGenerator.js)

Method: ⚠️ DEGRADED: single-context (nested subagents blocked by harness `experimental.subagent_depth`; assessments ran inline, sequential: A fully first, then B)
Mode: Operate (hashtag analytics dashboard, pt-BR, operator tooling)

## Design Health Score (Nielsen 10, 0–4 each)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading, "Última atualização", cache label, rate-limit chip all good — but the status dot is hardwired green and stays green through failures |
| 2 | Match System / Real World | 2 | "Erro: Failed to fetch" (raw English in a pt-BR UI), unitless "Relevância", truncated headers "SEG…/F…/RELEV…" |
| 3 | User Control and Freedom | 2 | Esc/backdrop/Fechar + "Voltar para hashtag diária" exist, but no URL state: refresh or share loses the selected view/hashtag; auto-refresh not stoppable |
| 4 | Consistency and Standards | 1 | Emoji-as-icon vs gradient chips, 4 separate button idioms, inline onclick mixed with addEventListener, div-as-button everywhere |
| 5 | Error Prevention | 2 | Rate-limit disabling, AbortController, overlap guard, stale-while-revalidate are real; but unsanitized `onclick="loadHashtagData('${tag.name}')"` interpolation (line 3335) breaks on apostrophes and is an injection vector |
| 6 | Recognition Rather Than Recall | 1 | Hashtag pills are click-only divs; clickable rows afford only via 👆 emoji and title tooltip; table headers truncated so column meaning must be recalled |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts, no sortable tables, no URL deep-links, fixed 5-min auto-refresh; multi-hashtag compare is the one win |
| 8 | Aesthetic and Minimalist Design | 2 | Rotating conic glows, gradient text on 6+ elements, pulsing dot, shake — decorative noise over an otherwise coherent bento layout |
| 9 | Error Recovery | 2 | Friendly pt-BR messages for 404/429/5xx and a retry button; but DOMException "Failed to fetch" leaks raw, and modal CORS fallback is good |
| 10 | Help and Documentation | 1 | Only hints: Ctrl/Cmd multi-select note and dotted-underline timezone tooltips |
| **Total** | | **17/40** | **Poor (12–19): major UX overhaul required** |

## Design Specificity Verdict

**LLM assessment:** Category-interchangeable. The look is the canonical "dark glassmorphism AI dashboard": #667eea→#764ba2 gradient (the single most-used gradient on the web), Inter, rgba(255,255,255,0.08) cards, conic rotating glows. Nothing is authored for Mastodon hashtags: the only product-specific element is a 🐘 emoji in a modal avatar. The product's own motif — the hashtag — is right there and unused as identity (a bold # mark, monospaced tabular numerals for counters, a Mastodon-adjacent purple used deliberately as a single brand hue instead of a 6-gradient rainbow).

**Deterministic scan:** 22 findings, exit 2: 6× gradient-text, 4× dark-glow (colored glows), 10× icon-tile-stack, 1× overused-font (Inter), 1× ai-color-palette (purple/violet), 1× pulsing-dot, 1× skipped-heading (h1→h3, no h2). Verified real: gradient-text, dark-glow, overused-font, ai-color-palette, pulsing-dot, skipped-heading. False positive: icon-tile-stack on card headers — `.card-header` is a flex row (icon beside heading, confirmed in screenshots); the stacked pattern genuinely applies only to KPI icons above values.

**Visual overlays:** No reliable user-visible overlay is available — overlay injection was skipped: no mutable browser session (no browser-automation MCP exposed; headless-chromium captures used as fallback signal).

## Overall Impression

Solid engineering serving UX (cache, abort, rate-limit state) wrapped in a borrowed skin. The desktop bento layout reads fine; the moment data hits the page, the fixed-layout tables fall apart (desktop truncation, mobile unusable), and the generated report card ships broken emoji glyphs. Biggest opportunity: replace the generic purple-glass skin with a hashtag-authored identity while restructuring the two data tables — that single move fixes both the slop family and the P0.

## What's Working

1. **State architecture**: stale-while-revalidate cache + AbortController + non-overlapping loads + rate-limit chip ("Requisições: --/--", reset countdown, disables Atualizar at limit) — honest system status where it counts.
2. **pt-BR + timezone discipline**: locale formatting everywhere, timezone detection with validation and fallback, timezone tooltips on dates.
3. **Empty states**: friendly, specific copy ("Nenhuma postagem encontrada hoje", "Selecione o ano e hashtag…") instead of blank areas.

## Priority Issues

1. **[P0] Mobile tables are unusable** — `table-layout: fixed` + `width: 100%` squeezes 6 columns into 390px: author renders one character per line, "Subindo" wraps vertically, relevance badge "9.3" stacks. Blocks the primary task on phones.
   Fix: card-list rows on ≤768px (author + stats inline), or auto table layout with min-widths + horizontal scroll wrapper. Suggested: `/impeccable adapt`.
2. **[P1] Keyboard/AT users cannot navigate** — hashtag pills and clickable rows are `<div>`s with click handlers: no tabindex, no role, no Enter/Space, no focus styles; zero `aria-*` in 5173 lines; heading levels skip h1→h3.
   Fix: real `<button>`/`<a>` elements, visible focus rings, `aria-label` on rows, h2 between. Suggested: `/impeccable harden` (then `/impeccable audit`).
3. **[P1] The status layer lies** — status dot is always green even when data failed to load; the error banner shows raw English "Erro: Failed to fetch" in a pt-BR interface.
   Fix: dot reflects state (green fresh / amber stale / red failed); map `DOMException: Failed to fetch` to "Não foi possível conectar ao servidor". Suggested: `/impeccable clarify`.
4. **[P1] Top Performers table fights its container** — fixed column widths (20/12/12/12/16/28%) in a half-width card truncate headers ("SEG…", "★ F…", "RELEV…") and wrap authors to 3 lines.
   Fix: cut columns (fold Seguidores into author line), rename headers to short real words, or move to a ranked list. Suggested: `/impeccable layout`.
5. **[P1] Generated report card is broken at the glyph level** — emoji icons (📊👥📝) drawn with DejaVu Sans (no emoji glyphs) render as abstract shapes; ~120px of dead space per card below the title; the committed `improved-dashboard-report.png` matches neither theme in code (stale evidence — regenerated dark/light samples differ); and on hosts without the DejaVu font files (Alpine images) even accents break — that is exactly the "PARTICIPANTES ?NICOS" in the committed PNG.
   Fix: replace emoji with drawn vector icons or plain text glyphs, tighten card vertical rhythm, verify font fallback, regenerate and re-commit the sample. Suggested: `/impeccable polish` scoped to imageGenerator.js.

## Persona Red Flags

**Alex (power user):** No keyboard shortcuts. Selected hashtag and view are not in the URL — refresh loses the weekly-history filters, nothing shareable. Fixed 5-min auto-refresh with no toggle. Sortable columns would be the first thing he tries; none exist.

**Sam (screen reader / keyboard):** Cannot switch hashtags at all by keyboard (pills are divs). Clickable table rows not focusable. Chart canvases have no text alternative. Trend conveyed by color+emoji only. Hover-only image captions in the modal.

**Riley (stress tester):** Report image: broken emoji glyphs; accented text breaks on hosts without registered fonts. Dashboard: `loadHashtagData('${tag.name}')` breaks with an apostrophe in a trending tag name (injection risk, external Mastodon data); `pillText.match(/#(\w+)/)` fails for accented hashtags (#café) so the active-pill state silently breaks.

## Minor Observations

- `renderKPICards` inserts each card with `insertBefore(firstChild)`, reversing the intended order: "Hashtag Atual" was authored first but renders last (confirmed in screenshot).
- `cursor: pointer` on KPI cards but no click action — false affordance.
- The header "Mastodon" link is ambiguous (rel=me verification?) and unlabeled visually.
- History filter bar wastes a full row (giant empty multi-select box; "Ano" stranded left, "Filtro" far right).
- Summary cards show a giant colored "-" placeholder with ~100px of empty space.
- `--text-muted` #718096 on card bg = 3.95:1 (fails AA), though it is barely used.
- White on cyan #4facfe (relevance badge) = 2.42:1; white on #fa709a (back button) = 2.68:1.
- Animations ignore `prefers-reduced-motion` (pulses, shake, rotating glows).
- Single 5173-line HTML file: two button systems, inline styles, and duplicated chart configs (updateWeeklyCharts/updateDailyCharts/updateWeeklyChartsMultiple are ~90% identical).

## Questions to Consider

- What if the hashtag were the hero — a giant authored # mark and the day's word, instead of a gradient "Hashpanel" wordmark saying the product's name to its only operator?
- What if the tables became ranked lists where "usos" is the bar length — more scannable than six columns and mobile-proof by construction?
- What if the status bar told the truth: green = fresh, amber = cached/stale, red = failed?

## Captures (fallback evidence, headless Chromium)

/tmp/opencode/assessA-desktop.png (error state) · A-dash-desktop.png (mock data) · A-dash-mobile.png (390px, P0 evidence) · A-history2.png (history view) · A-report-dark.png / A-report-light.png (regenerated samples vs stale improved-dashboard-report.png)
