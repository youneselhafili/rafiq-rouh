# DM panel invariants

These rules apply to every path that opens or delivers a user's private panel:

1. A user may have only one bot-owned DM panel.
2. `/dm_panel`, `/setup_dm`, panel buttons, and install webhooks must update the existing panel instead of creating another one.
3. Duplicate detection must use both pinned messages and recent DM history, because a panel can be manually unpinned.
4. When historical duplicates are found, keep one panel and delete only duplicate messages authored by this bot.
5. Never delete user-authored messages while cleaning duplicate panels.
6. DM settings remain user-scoped and must never read or overwrite server configuration.
7. Event webhook retries must be idempotent: the same authorization event may update the panel, but must not add another copy.
8. Mentions are disabled in automatic panel payloads.
9. Pinning is best-effort. A pin failure must not cause a second panel to be sent.
10. The panel message ID must be persisted after every successful send or update.
