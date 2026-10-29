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

**Explicitly not used (for now):** decorative illustrations or background graphics (a faint line-and-node header graphic was tried on Today and removed), gradients, glows, translucency, any hue other than the cool accent.

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
- **Hover lift** on clickable cards: up 2 px with a stronger shadow.
- Exact values: `--fl-shadow-*` in tokens.css.

---

## 7. Typography

- **UI:** Geist (400/500/600/700). **Mono:** Geist Mono (400/500) for times, counts, chips, keycaps, code.
- **Fonts are bundled with the app** (both are OFL-licensed). Never load them from Google Fonts at runtime: no network calls (APP-09, "your notes never leave your machine"), and the app must work offline.

| Role | Size / weight |
|---|---|
| List title (e.g. "Inbox · 7 open") | 30 / 700, -0.025em; "Inbox" in soft heading color, "· 7 open" in white |
| Today greeting | 36 / 700, -0.03em; soft color with the key phrase in white |
| Capture input | 20 / 400 |
| Note title | 32 / 700 white; H2 18 / 600 |
| Task text | 14 / 400 |
| Note body | 15 / 400, line-height 1.7 |
| Meta (times, counts, chips) | Geist Mono 12 |
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
- **Next-open notice in the capture popup (D-26, Proposed visual):** one line above the chips in `--fl-text-secondary` with a quiet button (`Undo`, `Retry`) and a dismiss ×. Never a separate window or overlay.

---

## 9. Motion

- **Spring:** `cubic-bezier(.2, .9, .3, 1.15)` for movement (drag settle, row leaving, chevron, menus, toasts).
- **Press:** `cubic-bezier(.2, .9, .3, 1.5)` on checkboxes and the send button (scale 0.86–0.9 → 1).
- **Durations:** 120 ms for hover/color; **150 ms ceiling** for everything else (matches 03 §5).
- **Completion:** the checked row fades and slides 10 px right while scaling to 0.985, then moves to Completed and the undo toast rises in.
- **Hover lift** on cards: translateY(-2px).
- **Reduce motion** disables all of it.

---

## 10. Screens

| # | Screen | Screenshot | Mockup | What it shows |
|---|---|---|---|---|
| 1 | Main window, Inbox | `design/screenshots/01-main-inbox.png` | `design/mockups/01-main-inbox.html` | Sidebar with icon tiles (active = strong tile); title with white emphasis; Ctrl+K pill; composer card (input, tool icons, shorthand hint chip `!h ##list @15:00`); task-list card with priority stripes, selected row, smart link chip, attachment/bell/body indicators, one expanded body with a stack-trace code card, a subtask; Completed card with count chip. Window controls top right. |
| 2 | Quick-capture popup | `design/screenshots/02-quick-capture.png` | `design/mockups/02-quick-capture.html` | Floating composer over a full-screen call: removable chips for parsed shorthand (priority, list, reminder) and an attachment; large input (`fix token refresh !h ##unicorn @15:00`); tools bottom left; target list + round send button bottom right; hint line under the card. A normal capture has **no after-save overlay**: the popup hiding is the confirmation (D-26). |
| 3 | Today | `design/screenshots/03-today.png` | `design/mockups/03-today.html` | Greeting heading with white emphasis; rollover card with bullets and Clear / Roll over; two reminder cards side by side; Focus card with home-list chips. |
| 4 | Note mode | `design/screenshots/04-note-mode.png` | `design/mockups/04-note-mode.html` | Live preview: headings, rounded-square bullets, an auto-linked `AB#1234` chip, raw `**` syntax visible at the cursor, checklist, code card with copy, slash menu with icon tiles; "Convert to task list" button. |
| 5 | Mini mode | `design/screenshots/05-mini-mode.png` | `design/mockups/05-mini-mode.html` | Segmented Today/Inbox toggle; in-app reminder card with Done / Snooze 10m / Open; compact rows; composer-style input. |
| 6 | Design system | `design/screenshots/06-design-system.png` | `design/mockups/06-design-system.html` | Accent and emphasis, priority stripes, bullets, grounds, text levels, type, components, depth levels, radius, motion. |

The mockups use example content (task titles, list names) for illustration only.

**Screenshots** are rendered from the HTML mockups with `node scripts/render-mockups.mjs [01 02 …]` (Playwright's Chromium, 2x). 01 and 02 were re-rendered for D-25 (`##` list shorthand) on 29 Oct 2026; re-rendering an unchanged mockup (03) reproduces its original screenshot. Neither screenshot shows the D-25 list card or the D-26 next-open notice; they are specified in §8.

Interactive versions (completing tasks with undo, live shorthand parsing in the capture box) were reviewed on the design canvas during design; the screenshots show their default states.
