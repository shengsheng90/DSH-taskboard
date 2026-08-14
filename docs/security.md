# Security and bounded recovery

- The database and attachment roots come only from validated Host configuration. The Client never scans or opens Host paths.
- Branded ids are preserved independently from readable keys such as `DSH-42`; no caller derives one from the other.
- Human-only transitions are enforced in the Provider. Model tools omit accept, delete, archive, force takeover, and generic status operations.
- Every mutable domain operation uses compare-and-set versions. Claim admission rechecks state, archive, dependencies, active ownership, and exclusive development context in one transaction.
- Attachment storage keys are random and root-contained. Filenames are display metadata only. Bytes are written with exclusive creation, fsync, and atomic rename before the row is committed.
- Upload/download URLs are random, short-lived, single-use capabilities issued over authenticated RPC. Active content is never displayed inline; responses set `nosniff`, sandbox CSP, and a safe disposition.
- Permanent task deletion is human-only, requires an archived unclaimed task, and cascades owned rows. Byte deletion failures enter a durable cleanup queue retried at startup and by `storage status`.
- A future SQLite schema is refused. Previous supported schema revisions migrate monotonically.
- Startup marks claims whose Agent no longer exists as orphaned. Only an enabled owning automation may attempt bounded original-Session recovery; otherwise the claim remains visible for a human decision.
- Automation quota uncertainty pauses new claims without changing running work. Shutdown stops timers and admission, then waits for in-flight publication.
- One bounded plugin-owned Typert long poll per open page waits for a committed global revision. Timeouts, Client reconnects, and the configured periodic snapshot interval compare fresh revisions, preventing permanent staleness without extending Harness event forwarding.

Storage backup should include both the SQLite database (including WAL files while live) and the attachment directory. For a consistent offline backup, stop Harness first. Restore both to matching configured locations before restart.
