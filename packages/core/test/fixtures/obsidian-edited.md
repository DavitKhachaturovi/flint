---
flint: 1
id: u9n1
mode: tasks
tags:
  - work
  - unicorn
aliases: [Unicorn tasks]
---
# Unicorn

Tasks for the Unicorn backend. Linked from [[Projects]].

> [!note] Sprint goal
> Ship the tenant cache before the demo.

## Backend
- [ ] Review [[Tenant cache]] design [priority:: highest] [due:: 2026-11-02] [id:: dcf64c] ^cache-review
- [ ] Profile (std::move) usage in the importer
- [ ] Check [Vec::new] behaviour under load [created:: 2026-10-20] [id:: 0h17ye]
- [-] Old migration plan [cancelled:: 2026-10-21]
- [ ] Call with infra (priority:: medium)
    - [ ] Prepare questions [id:: p1q2]
        - [ ] deeper item, part of the subtask's body

    Notes after a blank line, indented less than the subtask's content, belong to the parent.

## Frontend
- plain bullet, not a task
    - [ ] nested under a plain bullet, not a Flint task
1. [ ] numbered checkbox, not a Flint task
- [ ] Fix `[priority:: high]` example in docs [id:: f1x2]

## Completed
- [x] Upgrade Node in CI [completion:: 2026-10-27] [priority:: low] [id:: n0d3]
