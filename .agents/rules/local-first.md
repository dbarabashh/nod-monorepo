---
description: User data is owned by the user, lives on their devices, works offline, and never reaches a server in readable form.
alwaysApply: true
---

- Treat the user's device as the source of truth. Conversations, transcripts and notes are stored locally, and reading or editing them never requires a network connection.
- Encrypt user data at rest. Keep keys in OS secure storage (Electron `safeStorage`, which uses the platform keychain), never in plain files, config, logs or the repo.
- Sync only end-to-end encrypted data. Content leaves a device only as ciphertext that the sync server or relay cannot read. Never design a server feature that needs plaintext user content.
- Never add a central store of readable user data, including "temporary" ones: server-side logs, queues, caches, search indexes or analytics. Centralized plaintext is what leaks in a breach.
- Process audio in memory only. Never write it to disk, temp files, caches, debug dumps or crash reports. Persist only what the user chooses to keep.
- Let the user decide what is kept. Every stored item can be deleted, and deletion propagates to the user's other synced devices.
- Keep data exportable in open formats (JSON, Markdown) that are readable without the app. Never introduce a format only this app can open.
- Send content to a third-party service (for example an AI provider) only when the user has enabled it. Send the minimum needed, never to a service that retains it or trains on it, and make the destination visible to the user.
- Never add telemetry or crash reporting that can carry user content. Anything collected is opt-in.
- Store third-party access tokens on the device in secure storage, request the narrowest scopes, and let the user revoke them. A leaked token is a breach of every account it reaches.
- Merge concurrent edits from several devices without silently dropping data. Never resolve conflicts with a blind last-write-wins.
- Keep the data model and sync protocol platform-neutral. Other desktop OSes and future mobile clients must read the same data, so nothing may depend on Electron, Node or one OS.
