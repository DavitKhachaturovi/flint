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
- **Title bar and sidebar (D-69):** only the 40 px strip at the top of the window is a drag region; the sidebar below it is not, so right-clicking its empty space opens Flint's **+** menu instead of Windows' window menu.
- **Task in Edit state (TASK-02, D-74):** the row becomes a dark input field like the composer: `--fl-ground-well` with a 1 px `--fl-edge-card` inset edge and the row radius, no selected-row shadow; the selection highlight doesn't show while a row is edited.
- **Note page until M5 (D-64, D-68, Proposed visual):** no card around the text: the note's title as the page heading, then its text in Geist Mono 13.5 / 1.7 in `--fl-text-body` on the window ground, in the same content column as the lists (max 820 px), filling the page's height. **D-82:** task lists, notes and task pages share this 820 px column (D-81's 1160 px task column is reverted).
- **Untitled task in a list (D-45, M4):** a collapsed code row with the body's kind and line count in mono `--fl-text-faint` and a one-line peek; expandable like the popup's code blocks.
- **Popup window (D-42):** larger than the card by a transparent margin that holds the whole float shadow (72 px at the sides, 36 px above, 108 px below), with clicks passing through it; verified on a white desktop, a dark background and over text (29 Oct 2026).
- **Next-open notice in the capture popup (D-26, Proposed visual):** one line above the chips in `--fl-text-secondary` with a quiet button (`Undo`, `Retry`) and a dismiss ×. Never a separate window or overlay.
- **Cursors (UI-01, D-52):** `default` (arrow) on every control, `text` in text fields, `pointer` only on links (markdown links, smart-link chips). During a drag the arrow too (**Proposed**).
- **Scrollbar (UI-02, D-52, Proposed):** the main area scrolls as a whole, so the bar sits at the window's right edge. No track, no arrows: a 6 px pill thumb (`--fl-scroll-thumb`, hover `--fl-scroll-thumb-hover`) in a 10 px gutter. **D-80:** the sidebar's scrollbar reserves its gutter too, so its appearing never shifts the sidebar.
- **Pickers (CAP-11, D-57, Proposed visual):** one shared floating panel, 280 px wide, `--fl-ground-float` with `--fl-shadow-float` and `--fl-radius-row`, anchored under its tool button. Rows like menu items (icon tile, label, key hint); the list picker has a search field on top (`--fl-ground-well`), then every list, scrolling past about eight rows (D-68); the date/time picker a natural-language field with presets, then a month grid; picking a day swaps the grid for the **wheels** (D-70, mockup 08): a header with "‹ <day>" (back) and a "TIME" label, a 200 px well (`--fl-ground-well`, inset ring) with two Geist Mono columns (hours, minutes in 5-minute steps) separated by a colon, the centre value 22 px `--fl-text-primary` on a 40 px band in `--fl-ground-tile`, neighbours 18 px fading to `--fl-text-faint`; below it the primary "Set · Wed 4 Nov, 14:30" button. The active row uses the selected-row look; the mouse's highlight leaves with the mouse (D-69). In the calendar, today keeps its subtle marker and takes the normal hover like every other day (D-69).
- **Context menus (UI-08, D-55, Proposed visual):** the same floating panel style as the pickers, 220 px minimum width, items with an optional icon and a right-aligned key hint in mono, dividers in `--fl-edge-divider`. Drawn in the page everywhere, the capture popup included, which makes room for an open menu (D-64).
- **Overdue reminder (REM-11, D-58, D-68, D-69):** no "Overdue" word: the bell stays, a 5 px dot in `--fl-overdue-dot` (white) sits on its top-right corner, and the time keeps the bell's tone (not highlighted, D-69). No red, no badge. Turning the reminder off removes the dot and fades the time; nothing moves. A changed time crossfades from the old text to the new (§9).
- **Reminder turned off (REM-12, D-66, D-68):** the bell is a button and always stays in place. Turning the reminder off draws a strike line through the bell (`--fl-dur-state`, in both directions) and the time turns `--fl-text-faint`, also on hover and selection; an overdue dot disappears. The time next to it is a separate button that opens the date/time picker (REM-01).
- **Multi-select action bar (TASK-07, D-59, Proposed visual):** a floating-level bar centered at the bottom of the main area (toasts rise above it): "3 selected" in mono, then quiet buttons Select all · Move · Priority · Star · Delete and a ×. Selected rows look like the single selected row.
- **Task page (TASK-05, D-53, D-76):** replaces the list in the content column; a 30 px back-arrow icon tile left of the title, lined up with its first line; the title in `--fl-text-highlight`, 27 / 600, wrapping (also while it is edited); the body below in note-body type; then the subtasks as rows in a card with an "Add subtask" button.
- **Expanded task, D-78 (mockup 09, supersedes the details below where they differ):** while expanded, always a raised card: `--fl-ground-float`, `--fl-shadow-selected` (edge ring, top highlight, soft shadow), 14 px radius, padding 11 / 12 / 14 / 16 px, the title row and the body 12 px apart; the priority stripe runs the card's full height (14 px from top and bottom); the body 32 px in from the title row, 13.5 / 1.6 in `--fl-text-secondary`, its code cards inside.
- **Expanded task (TASK-05, D-77, mockup 01):** one raised card (the selected-row look: `--fl-ground-float`, `--fl-shadow-selected`, `--fl-radius-row`) holding the title row and, aligned with the title's text, the body: 13 / 1.6 in `--fl-text-secondary`; code and stack traces in a small code card (`--fl-ground-well`, 1 px `--fl-edge-card` ring, 12 px radius) with a 34 px header (the kind in mono 11 px `--fl-text-faint`, a 26 px copy button) and the code in mono 12 / 1.65. A long body shows about 8 lines fading out; its preview takes a soft hover and opens the page; "Open as page" below. The plain field (short bodies, until M5) takes exactly the rendered text's place and type.
- **Body indicators, thumbnails and the lightbox (TASK-05, MEDIA-01, D-79, Proposed visual):** the row's indicators are the body icon (three lines) when the body has text and an image icon (a framed landscape) when it has images, both when it has both, in the indicator tone with `--fl-text-primary` on hover; **D-80 (supersedes):** the body icon shows for any body, images only included, and expands it; the image icon shows in addition when there are images. Code cards carry a trash button next to their copy button (the same 26 px quiet icon button), and body images a 22 px trash tile in their top-right corner (`--fl-ground-tile`, `--fl-edge-chip` ring, icon `--fl-text-muted`, `--fl-text-primary` on hover); both show on hover of the card or image and take no click while hidden. Body images are at least 64 px on each side (cropped to fill), so a tiny image keeps a click target clear of its button. The deleted part folds away (height and opacity, `--fl-dur-state`). In an expanded row the images are thumbnails of at most 180 × 96 px (cropped to fill, `--fl-radius-tile`, the 1 px `--fl-edge-card` ring, `--fl-edge-chip` on hover); on the task's page they show at full size (up to 360 px high). Every body image has the zoom-in cursor, and a click opens the lightbox, as does the image icon. The lightbox covers the window with the solid `--fl-ground-window` ground (no translucency, §6; accepted, D-80); the image is centered with at least 68 px beside it and 60 px above and below, `--fl-radius-tile` and `--fl-shadow-float`; a 34 px close tile (`--fl-ground-tile`, `--fl-edge-chip` ring) sits at the top right below the title-bar controls; with more than one image, 34 px chevron tiles at the left and right edges and "2 / 3" in mono `--fl-text-muted` at the bottom center. Motion: the ground fades in and out over `--fl-dur-base`, the image scales in from 0.94 with the spring (out to 0.96); ←/→ slide the next image 16 px in over `--fl-dur-state`. Esc, a click outside the image or the close tile closes it; while it is open it takes every key.
- **Marked rows (TASK-07, D-77):** `--fl-ground-float`; adjacent marked rows join into one rounded block (inner corners square, no seam), a single mark keeps its own rounded highlight.
- **Guidance spotlight (APP-13, D-61, Proposed visual):** the window dimmed with `--fl-spotlight-dim`, the target cut out with a 2 px `--fl-accent` ring at 6 px offset and the target's own radius; a floating-level card next to it with one or two lines, a "2 / 6" counter in mono and Next (primary) / Skip / Skip all (quiet). Tips (APP-14) use only the card, in the bottom-right corner, without dim or ring.
- **App icon rule (UI-07, D-69, supersedes the tile and leaf numbers below):** for every size from 16 to 96 px the dark tile (`#191B20`) fills the whole square with Windows' app-icon corner radius (size / 24: 2 px at 48, 1 px at 24, Microsoft's icon grid) and a 1-pixel rim (`#3A404C`) on its edge, so the tile reads on the dark taskbar; the leaf is centred and its tips and outline span **72 % of the tile's diagonal** (scale 0.068 in `flint-icon-24.svg`, 0.045 in `flint-icon-16.svg`). 256 px stays the master.
- **App icon, taskbar and tray (D-74, replaces the radius and leaf size above):** drawn from `flint-taskbar-16.svg` and `flint-taskbar-24.svg`: the full-bleed tile with the **master's corner proportions** (108 / 480 ≈ 22.5 % of the side: 3.6 px at 16, 5.4 px at 24) and its 1-pixel rim; the leaf spans **65 %** of the diagonal (scale 0.0405 and 0.0612). The in-app logos (`flint-icon-16.svg` in the popup, the 512 px master in the sidebar) stay as they are.
- **Text selection (UI-11, D-69):** `::selection` everywhere, text fields included, is `--fl-selection` (the accent at about a third opacity) with `--fl-selection-text` (white). Never Windows blue.
- **Find bar (NAV-06, D-72, Proposed visual):** a floating-level bar at the top right of the content area, under the title-bar strip: a search field (`--fl-ground-well`), "2 of 7" in mono `--fl-text-faint`, previous / next icon buttons and a ×. Matches get `--fl-selection` as a background, the current one also a 1 px `--fl-accent` ring.
- **Sidebar groups, D-81 (supersedes the D-80 text below and mockup 10 on these points; the doc text wins):** the header is the section-label style of D-73 again: a chevron that turns 90° in `--fl-dur-base`, the name in 11 px uppercase +0.07em `--fl-text-faint` (`--fl-text-secondary` on hover and when picked), and the count as a plain number in mono; no folder tile, no guide line, its lists indented 8 px. An **expanded** group sits on a highlighted card (`--fl-ground-card`, radius 14 px, 1 px `--fl-edge-divider` ring, a faint top highlight, 3 px padding); a **folded** group is the plain label row. While a list is dragged over a group, its card shows a **white outline ring** (1.5 px `--fl-text-highlight`); a folded group shows the card and ring only then. The drag looks as in 0.4.14 (lifted on `--fl-ground-float` with `--fl-shadow-float`, no scale, no drop line); the card's edges follow its sliding lists without the spring's overshoot. Still from D-80: the animations (FLIP for moves and sorts, groups easing in and out, the pulse on a folded group taking a list).
- **Sidebar groups (LIST-05, D-80, `design/mockups/10-sidebar-groups.html`; superseded by D-81 for the look):** a group is a **soft card** (`--fl-ground-sidebar` lifted one step, radius 14 px, a 1 px ring at `--fl-edge-card` and a faint top highlight) holding its header and its lists. The header: a chevron that turns 90° in `--fl-dur-base`, a 26 px folder tile, the name in normal case (13.5 / 600, `--fl-text-primary`, never an uppercase label like "Lists") and the count in mono. Its lists sit inside, indented 14 px, on a 1 px guide line (`--fl-edge-card`) under the folder tile. **Collapsed**, the card is one row whose count reads "3 lists"; hover lightens the card slightly. **Proposed motion:** the card's height eases on expand and collapse (`--fl-dur-state`); a new group eases open at the top of Lists with its name field ("Enter saves · Esc cancels" under it) while the rows below slide down; a deleted group folds away and its lists slide out to the top level; Move to group, Remove from group and a new sort animate every row from its old place to its new one (FLIP, `--fl-dur-state`, the spring curve). **Dragging into a group:** the group card lights up with a 1.5 px accent ring (`--fl-accent`) plus a soft 5 px accent halo, its count turns into "Drop to add" in `--fl-text-primary`; a 2 px drop line in `--fl-text-primary` with a dot at its left end, indented like the group's lists, marks the landing spot; the dragged row lifts (`--fl-ground-float`, `--fl-shadow-float`, scale 1.02). A collapsed group's header under the dragged list lights up the same way (measured where the header rests, and held there while the list is over it); the dragged row shrinks to 0.9 so the lit card shows around it, and the card pulses once (a 1.03 scale and back, `--fl-dur-base`) when the list is dropped on it. While a list is dragged, a group card's surface stretches with its sliding rows, so a list making room inside a group never slides out of the card.
- **Sort (LIST-06, D-73, Proposed visual):** the sort button is a quiet icon button next to the **+** (three lines, shorter downwards), opening a small menu with a check on the current sort (a 13 px check at the right in `--fl-text-secondary`; the button's tooltip names the current sort); with a non-manual sort, an attempt to reorder shows a one-line hint ("Sorted by Created · switch to Manual to reorder").
- **App icon (UI-07, D-52):** the installer and the window use a multi-size `.ico` with **16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96 and 256 px** (Windows' sizes for title bar, taskbar and Start at 100–400 % scaling; at least 16/24/32/48/256 per Microsoft). 16 px is drawn from `assets/icon/flint-icon-16.svg`, 20–96 px from `flint-icon-24.svg`, 256 px from the 512 px master. The small logos keep the tile's rim visible on the dark taskbar (where the near-black tile itself disappears) and have less padding: the leaf spans the tile corner to corner, its tips inside the rim (D-68: tile radius 3 and 4 px, leaf scale 0.05 and 0.076; in 0.4.4 the leaf at 0.056 and 0.086 cut through the rounded corners; 0.046 and 0.068 in 0.4.1 looked small next to other apps' icons). The reminder toast shows the same small-size design larger as its `appLogoOverride` image (`resources/toast-logo.png`, 48 px at 2x); a toast that fails with it is shown again without it. The window's own icon is set too, so development builds don't show Electron's. Regenerate with `node scripts/render-icons.mjs` (also the tray PNGs).

---

## 9. Motion

- **Spring:** `cubic-bezier(.2, .9, .3, 1.15)` for movement (drag settle, row leaving, chevron, menus, toasts).
- **Press:** `cubic-bezier(.2, .9, .3, 1.5)` on checkboxes and the send button (scale 0.86–0.9 → 1).
- **Durations (D-75, 03 §5; motion never delays input, so these are fuller than D-67's):** 120 ms (`--fl-dur-fast`) for hover/colour; **200 ms** (`--fl-dur-base`) for selection movement, menus and pickers opening, the wheels settling; **320 ms** (`--fl-dur-page`, D-76) for list and page switching; **260 ms** (`--fl-dur-state`) for small state changes (a strike line, a fade, a crossfade); **360 ms** (`--fl-dur-complete`, D-76) for the whole completion sequence. Everything is interruptible and retargets on new input; nothing waits for an animation. The capture popup appears instantly (it may fade in, never delaying typing).
- **Completion (D-67, D-75):** the task moves to Completed at once (saved, undoable); a copy of the row plays out where it was: the check fills with a small pop (scale 1 → 1.15 → 1), then the row fades, slides 10 px right and collapses its height, while the task eases in under Completed and the undo toast rises in. **Un-completing** (also by undo or redo): the copy fades and collapses in Completed while the task eases back into the open tasks. All within `--fl-dur-complete` (400 ms).
- **List and page switching (D-67, D-75):** the content fades in with an 8 px rise in `--fl-dur-page` (280 ms), ease-out; the sidebar highlight glides in `--fl-dur-base`. The new content takes input at once.
- **Changed text (D-69):** a value that changes in place (a reminder time) crossfades from the old text to the new while its width eases, within `--fl-dur-state`. **Undoing a completion** plays the un-complete animation (D-69). The wheels picker's columns settle on the centre band with the spring curve in `--fl-dur-base` (D-70).
- **Hover lift** on cards: translateY(-2px).
- **D-76:** pickers open with a scale (0.96 → 1) and fade from their button's side; menus only fade; a picker replacing another morphs from the old panel's place and size while the contents crossfade. A new task opens up its place (height and fade). Un-completing: the ghost fades and slides up out of Completed while the task opens up its place in the open tasks. An inline body opens and closes by height and fade; a page slides in a few pixels from the right, and going back from the left; the editing field fades in and glides between rows like the selection.
- **Selection (UI-04, D-56):** the selection highlight glides to the new row (`--fl-dur-base`, spring); a new row eases in (fade + 4 px rise); pickers and menus scale in from 0.98. Drag reordering uses the spring curve for the rows sliding out of the way (D-54).
- **Reduce motion** disables all of it.

---

## 10. Screens

| # | Screen | Screenshot | Mockup | What it shows |
|---|---|---|---|---|
| 9 | Expanded task with body (D-78) | `design/screenshots/09-expanded-task.png` | `design/mockups/09-expanded-task.html` | The expanded task as one raised card with the full-height priority stripe, the body in the secondary tone and a stack trace in its code card, followed by a subtask and plain rows. |
| 10 | Sidebar groups (D-80; look superseded by D-81, §8) | `design/screenshots/10-sidebar-groups.png` | `design/mockups/10-sidebar-groups.html` | Groups as soft cards with a folder tile and the name in normal case, lists inside on a guide line; a collapsed group as one row with "3 lists" and the sort menu; dragging a list into a group (accent ring, "Drop to add", indented drop line, lifted row); a new group at the top of Lists with its name field. |
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
