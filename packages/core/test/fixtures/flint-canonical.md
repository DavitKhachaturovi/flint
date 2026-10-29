---
flint: 1
id: l7c2
mode: tasks
---
- [ ] Fix null ref in tenant resolver [reminder:: 2026-10-30T15:00] [priority:: high] [id:: k3f9]
    Stack trace from staging:
    ```
    NullReferenceException at TenantResolver.Resolve(...)
    ```
    - [ ] Add regression test [id:: m2p1]
- [ ] Ask about staging DNS [today:: true] [id:: q8x2]
- [ ] Update CI agent image [priority:: low] [id:: r5t0]

## Completed
- [x] Rotate service principal secret [completion:: 2026-10-28T14:03] [priority:: medium] [id:: a1b2]
