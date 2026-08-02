# Game Hub 2026 — Fable Audit & Ground Rules
File: `game_hub_2026.html` (737,262 bytes, 1,085 lines; line refs below are exact as of this audit).
Windows path: `C:\Users\User\AppData\Roaming\Claude\local-agent-mode-sessions\a96f1596-74e3-4edc-a428-3adb2061d17a\39d9ab94-10eb-47ac-ac23-31a44892fab8\local_81e15878-b22b-405a-a7fb-77fa221dc823\outputs\game_hub_2026.html`
Sandbox path: `/sessions/charming-zen-goldberg/mnt/outputs/game_hub_2026.html`

## A. Architecture map (where logos are rendered)

| # | Context | Code | Current treatment | Verdict |
|---|---------|------|-------------------|---------|
| 1 | Header team logos | HTML L283-294 (`.logo-slot data-default-w=56`), `applyTeamLogos()` L607-621 | img rendered at `L.w*(dw/56)` → **pitt 128x128, utes 56x56** | BROKEN (complaint 4). No CSS cap on `.logo-slot img`; phone media queries style a nonexistent `.logo-circle` (L144-145, L150-151) so header logos never shrink on phones |
| 2 | Calendar team headers | HTML L316-328 (`data-default-w=36`), same `applyTeamLogos()` | pitt 82x82, utes 36x36 | BROKEN, same root cause |
| 3 | Game Calendar rows | `fillTable()` L440-460 | TV: `appPill()` in `td.app`, CSS caps 44px (L71), 36px @720 (L143), 30px @480 (L156). Team logo fixed 40x40 (L455). Opp logos `ol.w*0.85` → **41px or 54px depending on source data** (L451) | Opp-logo sizes inconsistent (complaint 1/3); TV logo pill-class fallback survives (complaint 2); has `.sep-arrow` (good) |
| 4 | Coming Up cards | `renderCard()` L551-569 | TV: `appPill()` inside `.up-channel` — img renders at **raw baked w/h attrs (32 or 64px!)**, no CSS cap until 480px media. Team/opp: `.up-logo` 40x40 (L118), 32 @720, 28 @480 — uniform (good). **No `.sep-arrow`** (complaint 5). `.up-at` hardcodes the literal text `at` even for home games (L566 bug) | BROKEN: TV logos 32 vs 64px side by side; missing arrow; wrong at/vs |
| 5 | Timeline & Cost checklist | `svcLogoImg()` L653-657, `.item .svc-logo` CSS L98 | 48x48, object-fit:contain, border-radius:8px | **GOLD STANDARD** (Cameron-approved). Add the shadow (`box-shadow:0 1px 3px rgba(0,0,0,.25)`) + `background:#fff` to make it explicit and portable |
| 6 | Cost tracker `.svc` rows | static pills L347-352 + `refreshStaticPills()` L591-604 | data-svc pills swapped to 48x48 logo imgs, radius 4px. **Max contingency (L352) hardcoded 28x28** | Max is undersized vs siblings |
| 7 | Calendar TBD note | L333 (`data-svc` espn/fox) | `refreshStaticPills` sizes them `Math.min(w,48)` = 32px, radius 4px | Inline-text context; needs canonical treatment at consistent inline size |
| 8 | Legend | CSS only (L44, 139-140, 167); `.closest('.legend')` in refreshStaticPills | **No `.legend` markup exists** — dead CSS + dead JS branch | Dead code; do not resurrect |
| 9 | Admin panel previews | L224-239, L714 | admin-only, stripped on bake | Out of scope |

## B. Data facts

- `#baked-logos` JSON (single line, L256): `pitt {w:128,h:128, png 128x128 RGBA, transparent}`; `utes {w:56,h:56, webp 250x229 RGBA, transparent}`; TV logos: yt 32/32 (source 3840x2160!), prime 32, pcock 64, espn 32, fox 32, nfl 32, tbd 32 (source 560x360), max 32 (only max has alpha; rest are opaque white/colored squares → the white rounded square IS the intended look for TV logos).
- `customLogos` (L364-365) = `{pcock fallback}` merged with baked JSON. `oppLogos` (L438): 29 entries, NFL teams w:64, colleges w:48 — all RGBA transparent (spot-checked 5).
- Team logo sources are transparent; the "white box" complaint comes from `.logo-pill img{background:#fff}` (L56) leaking onto anything rendered through the pill path plus opaque-looking oversized renders — team logos must never go through `.logo-pill`.

## C. Structural hazard (root cause of "fix one, break another")

A past edit pasted the ENTIRE `renderComingUp()` (130 lines incl. its own `renderCard`) **inside** two admin functions:
- inside `applySvcDrop()`: L777-903 (pasted copy ends `renderComingUp(); refreshStaticPills(); }`)
- inside `resizeSvc()`: L920-1046 (same pattern)

So `renderCard` exists at L551, L864, and L1007. Only L551 runs on load; the local copies shadow it whenever a service logo is dropped/resized in admin mode. Any card fix applied to one copy silently regresses in the others. This MUST be deduplicated (see impl spec §6) — the pasted bodies collapse to `renderComingUp(); refreshStaticPills();` calls against the global.

## D. GROUND RULES (invariants — enforce on every future edit)

1. **One TV-logo treatment, everywhere.** Every streaming/TV logo renders as the checklist gold standard: square box, `object-fit:contain`, `background:#fff`, `border-radius:8px`, `box-shadow:0 1px 3px rgba(0,0,0,.25)`. Never a colored pill, never bare. The only per-context variable is the box SIZE.
2. **Size comes from CSS classes, never from data.** No `width`/`height` HTML attributes derived from `customLogos[k].w/h` or `oppLogos[k].w/h` anywhere in rendered output. Baked w/h values are metadata only. New logos dropped via admin panel must therefore render correctly with zero size data.
3. **One size ladder per context** (desktop / ≤720px / ≤480px), applying to ALL logos (team, opponent, TV) in that context:
   - Header team logos: 56 / 48 / 40
   - Coming Up card (TV + team + opp): 40 / 32 / 28
   - Calendar table (TV + team + opp): 40 / 32 / 28
   - Checklist + cost `.svc` rows: 48 / 48 / 28-32 (existing @480 rules)
   - Inline-in-sentence chips (TBD note): 28 fixed
4. **Team logos are transparent.** No `background`, no forced `#fff`, no `.logo-pill` class on any team or opponent logo. `object-fit:contain` in a square box so pitt and utes occupy identical footprints.
5. **Matchup rows always carry the grey `.sep-arrow`** before the visitor logo, in BOTH `fillTable` and `renderCard`, and the at/vs text is computed (`isAway?'at':'vs'`), never hardcoded.
6. **Single source of truth for functions.** Exactly one definition each of `renderCard`, `renderComingUp`, `appPill`, `fillTable`, `refreshStaticPills`, `applyTeamLogos` — all in `#app-script`. `#admin-script` may only CALL them. After any edit: `grep -c "function renderCard"` must equal 1.
7. **Bake safety.** `#admin-script`, `#admin-style`, `#admin-panel` are stripped on bake; any behavior the baked page needs must live in `#app-script` or `#baked-logos`. Never put display logic in admin script.
8. **Phone-first check.** Any new logo context needs entries in BOTH the 720px and 480px media queries. No selector may reference markup that doesn't exist (delete, don't imitate, `.logo-circle`).
9. **Edit hygiene for this file.** It is one line-per-statement with multi-hundred-KB base64 lines. Never regex-replace across base64 payloads; anchor edits on unique non-base64 substrings. Verify byte count changes are plausible after each edit.

## E. Verification checklist after implementing

1. `grep -c "function renderCard" file` == 1; same for `renderComingUp`.
2. Open in browser: no console errors; all three tabs render.
3. Coming Up: TV logos identical size; arrow present; "vs" shows for home games.
4. Calendar: pitt and utes header logos same size; all row logos one size.
5. Header: two logos same size, shrink at 720/480 widths.
6. Simulate 390px width (iPhone portrait): no horizontal scroll on any tab.
7. Bake & Export still downloads and the baked file renders identically (admin bits gone).
