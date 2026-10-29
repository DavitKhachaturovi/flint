---
flint: 1
id: h4nd
mode: tasks
---
Intro paragraph someone typed above the tasks.

- [ ] Task without an id
- [ ] Copy-pasted task [id:: dup1]
- [ ] Copy-pasted task [id:: dup1]
- [x] Checked by hand above the heading, no completion field
- [ ] Unchecked but has completion [completion:: 2026-10-01T09:00] [id:: unc1]
- [ ] Deploy hotfix [priority:: urgent] [reminder:: tomorrow]
- [ ] Two priorities [priority:: high] [priority:: low] [id:: two2]
- [ ] Mid-line [priority:: high] field and glued[today:: true]text

<!-- a comment that hides
- [ ] this line, which is not a task
-->

```
- [ ] not a task either, inside a top-level code block
```

    - [ ] indented code block at the top level, not a task

- [ ]
- [ ] Last task, file has no final newline [id:: last]