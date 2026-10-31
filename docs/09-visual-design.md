# 09 — Visual Design (v1, dark mode)

This is the source of truth for how Flint **looks**. Behaviour and interaction live in [03](03-ux-and-design-language.md); this document defines the visual language, the tokens, and each screen.

- **Tokens:** [`design/tokens.css`](design/tokens.css) (implement from these; never hard-code hex values in components).
- **Screenshots:** [`design/screenshots/`](design/screenshots/) (PNG, 2x).
- **Static mockups:** [`design/mockups/`](design/mockups/) (plain HTML, open in a browser; hover states work). They are references, not app code.

---

## 1. Direction

**"Solid glass."** Smooth, elegant, calm. The feel of Apple's Liquid Glass (soft depth, light catching edges, springy motion, generous rounded corners) **without translucency**: every surface is an opaque gray.

**Inspiration:** a chat-style Excel add-in for Excel. Taken from it:
- Soft, layered shadows under cards.
- Smooth, generous rounded corners.
- **Icon tiles**: icons sit in small rounded squares.
- **Chips** with an icon and monospaced text (the add-in's `Sheet1!A1` style), removable with ×.
- A composer-style input: chips above the text, small tools below, round send button.
- Headings with the key words emphasized.
- Rounded-square bullets.

**Translated to Flint:** where the add-in uses purple for highlights, Flint uses **white**. Everything else is grayscale plus one cool gray accent.

**Explicitly not used (for now):** decorative illustrations or background graphics (a faint line-and-node header graphic was tried on Today and removed), gradients, glows, translucency, any hue other than the cool accent. One deliberate exception: the guidance spotlight's soft dim over the window (APP-13, D-61).

---

## 2. Scope

- **v1 is dark mode only.** Light mode is Later (the theme setting in APP-11 ships with dark only).
- Palette: grayscale, accent **`#9AA0AB`** (a cool gray matched to the logo's blue-grays), emphasis **`#FFFFFF`**.
- `#999E98` was considered and rejected: it has a slight green tint that clashes with the cool logo and the "no greens" brand rule.

---

## 3. Color

### Grounds (back to front)
| Token | Hex | Use |
|---|---|---|
| `--fl-ground-window` | `#0D0E10` | Main window background |
| `--fl-ground-sidebar` | `#111214` | Sidebar |
| `--fl-ground-card` | `#151619` | Cards (task list, composer, Completed, reminder cards) |
| `--fl-ground-float` | `#1B1D20` | Capture popup, toasts, menus, selected row |
| `--fl-ground-tile` | `#1F2124` | Icon tiles, chips, keycaps |
| `--fl-ground-well` | `#0E0F11` | Code blocks, inset inputs |
| `--fl-ground-hover` | `#1A1B1E` | Row hover |

### Text
| Token | Hex | Use |
|---|---|---|
| `--fl-text-highlight` | `#FFFFFF` | Emphasised words, active nav label, high-priority stripe |
| `--fl-text-primary` | `#ECEDEE` | Primary text |
| `--fl-text-body` | `#E3E4E6` | Task titles |
| `--fl-text-heading-soft` | `#B9BDC4` | Heading base colour (key words in highlight) |
| `--fl-text-secondary` | `#A4A7AB` | Secondary text |
| `--fl-text-muted` | `#8E9196` | Lowest level for text that must be readable (≥ 4.5:1 on the window) |
| `--fl-text-faint` | `#75787D` | Section labels, completed task titles. **Below 4.5:1**: only for de-emphasised content; switch to muted if accessibility review requires it |

### Accent and emphasis
- **Accent `#9AA0AB`**: focus rings, text caret, checked checkboxes, bullets, medium-priority stripe.
- **Emphasis `#FFFFFF`**: the key words in headings, the active sidebar label, the high-priority stripe.
- **Strong surfaces `#ECEDEE` with dark content `#0E0F11`**: the active icon tile, primary buttons, the enabled send button, toast confirmation tiles.

---

## 4. Priority styling (resolves Q-01)

Priority uses **lightness and thickness only, never hue**, so it is color-blind-safe by default and fits the grayscale palette:

| Priority | Stripe |
|---|---|
| High | 4 px, `#FFFFFF` |
| Medium | 3 px, accent `#9AA0AB` |
| Low | 2 px, `#55585D` |
| None (default) | No stripe |

The stripe sits on the left edge inside the row (inset 3 px, 11 px from top and bottom, rounded ends). Rows are never tinted. The separate "color-blind-safe palette" setting from TASK-03 is therefore no longer needed for v1 (see D-17).

---

## 5. Shape

| Element | Radius |
|---|---|
| Checkboxes, chips | 7 px |
| Icon tiles | 8 px (26 px tile), 9 px (30 px tile) |
| Buttons | 10 px |
| Rows, sidebar items, menu items | 12 px |
| Cards | 18 px |
| Capture popup, mini mode window | 22 px |
| Segmented controls, keycaps | follow the element they sit in |

Corners get rounder as surfaces get larger and higher.

---

## 6. Depth: solid, not translucent

Three levels, all opaque:

| Level | Used for | Recipe |
|---|---|---|
| **0 · Flat** | Sidebar, page | No shadow |
| **1 · Card** | Task list, composer, Completed, reminder cards, code blocks | 1 px edge ring `#232529` + a faint inner top highlight (white at 4.5%) + a tight 1–2 px contact shadow + a soft, wide drop shadow |
| **2 · Floating** | Capture popup, toasts, slash/autocomplete menus, mini mode | Brighter edge `#2A2C30` + stronger top highlight (7%) + a deep, wide drop shadow |

- The **inner top highlight** is what gives the "light catching a glass edge" feel without translucency.
- **Selected rows** get a level-1.5 treatment: `#1E2023` background, edge ring, top highlight, small drop shadow.
- **Hover next to selection (UI-03, D-52, Proposed):** rows sit 2 px apart inside the card, so two row backgrounds never touch; the selected row keeps its level-1.5 look under the pointer; hover on other rows is `--fl-ground-hover` without ring or shadow.
- **Hover lift** on clickable cards: up 2 px with a stronger shadow.
- Exact values: `--fl-shadow-*` in tokens.css.

---

## 7. Typography

- **UI and text:** **Onest** (400/500/600/700; variable, from `github.com/simpals/onest`, OFL 1.1). **Georgian:** **FiraGO** 1.001 (bBox Type, OFL 1.1), Regular/Medium/SemiBold/Bold, applied only to Georgian characters with `unicode-range: U+10A0-10FF, U+1C90-1CBF, U+2D00-2D2F`, so Latin and Cyrillic stay Onest. **Mono:** Geist Mono (400/500) for times, counts, chips, keycaps, code; FiraGO is its fallback for Georgian characters (**Proposed**). Decided in D-60 (supersedes the font part of D-17).
- **Fonts are bundled with the app** (all OFL-licensed, licence texts shipped alongside). Never load them from Google Fonts at runtime: no network calls (APP-09, "your notes never leave your machine"), and the app must work offline.
- Flint ships the official files **unmodified** (no subsetting or format conversion of our own): Onest 2.001's variable `Onest[wght].woff2` from its release, and FiraGO's `FiraGO_WEB_1001` WOFF2 files for Regular, Medium, SemiBold and Bold, each with its licence (`apps/desktop/src/renderer/fonts/OFL-*.txt`). Some copies of FiraGO name "Fira" as a Reserved Font Name; the licence in the official repository declares none, and unmodified files keep the name usable either way (D-64). Georgian glyphs are only loaded by the renderer when Georgian text appears (`unicode-range`), so they cost nothing otherwise.
- The sizes below stay as they are with Onest unless the re-rendered screens show a need to adjust.

| Role | Size / weight |
|---|---|
| List title (e.g. "Inbox · 7 open") | 30 / 700, -0.025em; "Inbox" in soft heading color, "· 7 open" in white |
| Today greeting | 36 / 700, -0.03em; soft color with the key phrase in white |
| Capture input | 20 / 400 |
| Note title | 32 / 700 white; H2 18 / 600 |
| Task text | 14 / 400 |
| Note body | 15 / 400, line-height 1.7 |
| Meta (times, counts, chips) | Geist Mono 12 |
| Sidebar wordmark "Flint" | 17 / 600 (was 15), logo tile 34 px (was 30) (UI-07, **Proposed**) |
| Section labels | 11, uppercase, +0.07em tracking, faint |

---

## 8. Components

- **Icon tile:** 26 px (sidebar) or 30 px (cards, menus) rounded square. Default: `#1F2124` with inset ring, icon `#B9BDC4`. **Strong** (active/important): `#ECEDEE` with dark icon and a small shadow. Only one strong tile per group.
- **Chip:** 24–28 px tall, 7 px radius, `#1F2124` + inset ring, Geist Mono 12, optional leading icon, optional × remove button. Used for list names, reminder times, smart links (PR 42, AB#1234), attachments, and parsed capture shorthand.
- **Buttons:** Primary = strong surface (`#ECEDEE`, dark text, shadow). Secondary = `#26282C` with top highlight. Quiet = text only.
- **Checkbox:** 20 px, 7 px radius, 1.5 px border `#4A4D52`; hover border accent; checked = accent fill with dark check; press shrinks to 0.86 and rebounds.
- **Bullets (notes):** 6 px rounded squares in the accent.
- **Toast:** floating level, 16 px radius, strong tile with a check + message + secondary "Undo" button.
- **Code block:** card on the well color with a header bar (language label left, copy button right).
- **Icons:** simple 1.8–2 px stroke line icons, rounded caps. No emoji anywhere in the UI.
- **Non-task content in task lists (TASK-15, D-22, Proposed visual):** headings use the section-label style (11 px, uppercase, +0.07em, faint) as quiet dividers between rows; other text is note-body markdown in `--fl-text-muted`. No hover, selection or edit affordances.
- **List card in the capture popup (D-25, Proposed visual):** a floating-level row under the input, in the style of the autocomplete menu: the offered list as a chip with its key (`Unicorn · Enter`), then the alternative in secondary text (`New list "unis" · Tab`). Keys are shown as keycaps. Tab visibly flips the card: the chosen option becomes the highlighted chip with `Enter`, the other drops to secondary text (D-29).
- **Selection area (D-38):** blocks on `--fl-ground-well` with a 1 px `--fl-edge-card` ring and `--fl-radius-row`; a code block has a mono label (`JSON · 8 lines`) in `--fl-text-faint`, an expand chevron and a remove ×, and shows its first four lines collapsed; JSON keys `--fl-text-heading-soft`, strings `--fl-text-primary`, numbers and literals `--fl-text-highlight`; a stack trace's exception line `--fl-text-highlight`, frames `--fl-text-faint`, `file:line` `--fl-text-secondary`. No colours beyond the tokens. **Highlighting colours superseded by §11 (D-63).**
- **Popup close × and drag (D-46, D-47, D-68):** a 22 px × button in the card's top right (`--fl-text-faint`, hover `--fl-edge-float`). The popup is dragged only by a small grip centred at the top of the card (a 32 × 4 px pill in `--fl-edge-chip`, brighter on hover, **Proposed**); the card's background no longer drags it.
- **Note page until M5 (D-64, D-68, Proposed visual):** no card around the text: the note's title as the page heading, then its text in Geist Mono 13.5 / 1.7 in `--fl-text-body` on the window ground, in the same content column as the lists (max 820 px), filling the page's height.
- **Untitled task in a list (D-45, M4):** a collapsed code row with the body's kind and line count in mono `--fl-text-faint` and a one-line peek; expandable like the popup's code blocks.
- **Popup window (D-42):** larger than the card by a transparent margin that holds the whole float shadow (72 px at the sides, 36 px above, 108 px below), with clicks passing through it; verified on a white desktop, a dark background and over text (29 Oct 2026).
- **Next-open notice in the capture popup (D-26, Proposed visual):** one line above the chips in `--fl-text-secondary` with a quiet button (`Undo`, `Retry`) and a dismiss ×. Never a separate window or overlay.
- **Cursors (UI-01, D-52):** `default` (arrow) on every control, `text` in text fields, `pointer` only on links (markdown links, smart-link chips). During a drag the arrow too (**Proposed**).
- **Scrollbar (UI-02, D-52, Proposed):** the main area scrolls as a whole, so the bar sits at the window's right edge. No track, no arrows: a 6 px pill thumb (`--fl-scroll-thumb`, hover `--fl-scroll-thumb-hover`) in a 10 px gutter.
- **Pickers (CAP-11, D-57, Proposed visual):** one shared floating panel, 280 px wide, `--fl-ground-float` with `--fl-shadow-float` and `--fl-radius-row`, anchored under its tool button. Rows like menu items (icon tile, label, key hint); the list picker has a search field on top (`--fl-ground-well`), then every list, scrolling past about eight rows (D-68); the date/time picker a natural-language field with presets, then a month grid; picking a day swaps the grid for a time-of-day view: a back button naming the day, common times (future ones only), and an "Other time" field (D-68). The active row uses the selected-row look.
- **Context menus (UI-08, D-55, Proposed visual):** the same floating panel style as the pickers, 220 px minimum width, items with an optional icon and a right-aligned key hint in mono, dividers in `--fl-edge-divider`. Drawn in the page everywhere, the capture popup included, which makes room for an open menu (D-64).
- **Overdue reminder (REM-11, D-58, D-68):** no "Overdue" word: the bell stays, a 5 px dot in `--fl-overdue-dot` (white) sits on its top-right corner, and the time is `--fl-text-primary` instead of the faint indicator text. No red, no badge. Turning the reminder off removes the dot and fades the time; nothing moves.
- **Reminder turned off (REM-12, D-66, D-68):** the bell is a button and always stays in place. Turning the reminder off draws a strike line through the bell (`--fl-dur-state`, in both directions) and the time turns `--fl-text-faint`, also on hover and selection; an overdue dot disappears. The time next to it is a separate button that opens the date/time picker (REM-01).
- **Multi-select action bar (TASK-07, D-59, Proposed visual):** a floating-level bar centered at the bottom of the main area (toasts rise above it): "3 selected" in mono, then quiet buttons Select all · Move · Priority · Star · Delete and a ×. Selected rows look like the single selected row.
- **Task page (TASK-05, D-53, Proposed visual):** replaces the list in the content column; a 30 px back-arrow icon tile left of the title (note-title style, 32 / 700), the body below in note-body type.
- **Guidance spotlight (APP-13, D-61, Proposed visual):** the window dimmed with `--fl-spotlight-dim`, the target cut out with a 2 px `--fl-accent` ring at 6 px offset and the target's own radius; a floating-level card next to it with one or two lines, a "2 / 6" counter in mono and Next (primary) / Skip / Skip all (quiet). Tips (APP-14) use only the card, in the bottom-right corner, without dim or ring.
- **App icon (UI-07, D-52):** the installer and the window use a multi-size `.ico` with **16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96 and 256 px** (Windows' sizes for title bar, taskbar and Start at 100–400 % scaling; at least 16/24/32/48/256 per Microsoft). 16 px is drawn from `assets/icon/flint-icon-16.svg`, 20–96 px from `flint-icon-24.svg`, 256 px from the 512 px master. The small logos keep the tile's rim visible on the dark taskbar (where the near-black tile itself disappears) and have less padding: the leaf spans the tile corner to corner (scale 0.056 and 0.086 since D-65; 0.046 and 0.068 in 0.4.1, which still looked small next to other apps' icons). The reminder toast shows the same small-size design larger as its `appLogoOverride` image (`resources/toast-logo.png`, 48 px at 2x); a toast that fails with it is shown again without it. The window's own icon is set too, so development builds don't show Electron's. Regenerate with `node scripts/render-icons.mjs` (also the tray PNGs).

---

## 9. Motion

- **Spring:** `cubic-bezier(.2, .9, .3, 1.15)` for movement (drag settle, row leaving, chevron, menus, toasts).
- **Press:** `cubic-bezier(.2, .9, .3, 1.5)` on checkboxes and the send button (scale 0.86–0.9 → 1).
- **Durations (D-67, 03 §5):** 120 ms for hover/colour; up to **150 ms** (`--fl-dur-base`) for motion that gates the next action (selection, navigation, menus, pickers); up to **250–300 ms** (`--fl-dur-state`, 260 ms) for non-blocking state changes (a strike line, fades, completion feedback).
- **Completion (D-67):** the check fills with a small pop (scale 1 → 1.15 → 1), then the row fades, slides 10 px right and collapses its height, and moves to Completed; the undo toast rises in. **Un-completing:** the row fades and collapses in Completed and eases back into the open tasks. All within `--fl-dur-state`.
- **List and page switching (D-67):** the content fades in with a 6 px rise in 150 ms, ease-out (the sidebar highlight glides in the same time).
- **Hover lift** on cards: translateY(-2px).
- **Selection (UI-04, D-56):** the selection highlight glides to the new row (`--fl-dur-base`, spring); a new row eases in (fade + 4 px rise); pickers and menus scale in from 0.98. Drag reordering uses the spring curve for the rows sliding out of the way (D-54).
- **Reduce motion** disables all of it.

---

## 10. Screens

| # | Screen | Screenshot | Mockup | What it shows |
|---|---|---|---|---|
| 1 | Main window, Inbox | `design/screenshots/01-main-inbox.png` | `design/mockups/01-main-inbox.html` | Sidebar with icon tiles (active = strong tile); title with white emphasis; Ctrl+K pill; composer card (input, tool icons, shorthand hint chip `!h ##list @15:00`); task-list card with priority stripes, selected row, smart link chip, attachment/bell/body indicators, one expanded body with a stack-trace code card, a subtask; Completed card with count chip. Window controls top right. |
| 2 | Quick-capture popup | `design/screenshots/02-quick-capture.png` | `design/mockups/02-quick-capture.html` | Floating composer over a full-screen call: removable chips for parsed shorthand (priority, list, reminder) and an attachment; large input (`fix token refresh !h ##unicorn @15:00`); tools bottom left; target list + round send button bottom right; key hint inside the card's bottom toolbar (D-42, it used to sit under the card, unreadable on light backgrounds and over text). Pasted code, JSON and stack traces show as compact blocks under the single-line title (D-38), not in the input. A normal capture has **no after-save overlay**: the popup hiding is the confirmation (D-26). |
| 3 | Today | `design/screenshots/03-today.png` | `design/mockups/03-today.html` | Greeting heading with white emphasis; rollover card with bullets and Clear / Roll over; two reminder cards side by side; Focus card with home-list chips. |
| 4 | Note mode | `design/screenshots/04-note-mode.png` | `design/mockups/04-note-mode.html` | Live preview: headings, rounded-square bullets, an auto-linked `AB#1234` chip, raw `**` syntax visible at the cursor, checklist, code card with copy, slash menu with icon tiles; "Convert to task list" button. |
| 5 | Mini mode | `design/screenshots/05-mini-mode.png` | `design/mockups/05-mini-mode.html` | Segmented Today/Inbox toggle; in-app reminder card with Done / Snooze 10m / Open; compact rows; composer-style input. |
| 6 | Design system | `design/screenshots/06-design-system.png` | `design/mockups/06-design-system.html` | Accent and emphasis, priority stripes, bullets, grounds, text levels, type, components, depth levels, radius, motion. |
| 7 | Code highlighting | `design/screenshots/07-code-highlighting.png` | `design/mockups/07-code-highlighting.html` | The grayscale code token scheme (D-63, §11): a legend of token kinds, then JSON, YAML, TypeScript, bash and a stack trace highlighted with lightness, weight, italics and the accent for strings, and a card with the rules. Already set in Onest (D-60). |

The mockups use example content (task titles, list names) for illustration only.

**Screenshots** are rendered from the HTML mockups with `node scripts/render-mockups.mjs [01 02 …]` (Playwright's Chromium, 2x). 01 and 02 were re-rendered for D-25 (`##` list shorthand) on 29 Oct 2026; re-rendering an unchanged mockup (03) reproduces its original screenshot. Neither screenshot shows the D-25 list card or the D-26 next-open notice; they are specified in §8.

Interactive versions (completing tasks with undo, live shorthand parsing in the capture box) were reviewed on the design canvas during design; the screenshots show their default states.

All mockups use Onest since UI-05 was built (31 Oct 2026, D-60); screenshots 01–07 were re-rendered then.

---

## 11. Code highlighting (UI-06, D-63)

Grayscale: tokens differ by **lightness, weight and italics**, plus the cool accent for strings. No hues. Reference: mockup 07. Used by the capture popup's JSON / stack-trace highlighter and rendered task bodies (M4) and by the CodeMirror theme for all languages (M5). Supersedes the highlighting colours listed for the selection area in §8 (D-38).

| Token kind | Token | Value | Style |
|---|---|---|---|
| Plain code text | `--fl-code-plain` | `#C9CCCF` | regular |
| Keywords | `--fl-code-keyword` | `#FFFFFF` | semibold (600) |
| Numbers | `--fl-code-number` | `#FFFFFF` | regular |
| Literals (`true`, `false`, `null`) | `--fl-code-literal` | `#FFFFFF` | italic |
| Keys, variables, properties | `--fl-code-key` | `#E3E4E6` (light gray) | regular |
| Strings | `--fl-code-string` | accent `#9AA0AB` | regular |
| Functions | `--fl-code-function` | `#ECEDEE` | medium (500), faint underline `--fl-code-underline` `#3A3D42`, offset 3 px |
| Types, flags | `--fl-code-type` | `#B9BDC4` (mid gray) | italic |
| Punctuation | `--fl-code-punctuation` | `#6E7176` (dim gray) | regular |
| Comments | `--fl-code-comment` | `#6E7176` | italic |
| Stack trace: exception line | `--fl-code-exception` | `#FFFFFF` | semibold (600) |
| Stack trace: frames | `--fl-code-frame` | `#8E9196` (dimmed) | regular |
| Stack trace: `file:line` | `--fl-code-location` | `#C9CCCF` | faint underline like functions |

- Punctuation and comments (`#6E7176`) are below 4.5:1 on `--fl-ground-well`, like `--fl-text-faint`: acceptable because they are de-emphasised on purpose.
- The code-block card itself is unchanged (§8: well colour, header bar with language label and copy button).
