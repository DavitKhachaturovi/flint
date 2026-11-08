# Spec examples (test data only)

The note editor's tests (D-141) run every example of these specifications through the live preview.
They are test fixtures: never imported by the app and never part of the installer.

- `commonmark-0.31.2.json`: the examples of the **CommonMark Spec**, version 0.31.2 (2024-01-28),
  by John MacFarlane, <https://spec.commonmark.org/0.31.2/>.
- `gfm-0.29-extensions.json`: the extension examples (tables, task list items, strikethrough,
  autolinks, disallowed raw HTML) of the **GitHub Flavored Markdown Spec**, version 0.29-gfm
  (2019-04-06), <https://github.github.com/gfm/>, from `test/spec.txt` in
  <https://github.com/github/cmark-gfm>.

Both specifications are licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/)
(CC BY-SA 4.0), and so are these files, which are adapted from them.

**Changes:** only each example's markdown, number and section are kept (the expected HTML is
dropped); GFM's `→` is written as a tab; only GFM's extension examples are kept. Regenerate with
`node scripts/editor-spec-fixtures.mjs <spec.json> <spec.txt>`.
