---
description: Commit message format and when to commit.
alwaysApply: true
---

- Write commit messages in all lowercase, max 4–5 words: `add tray menu`, `fix window restore on activate`.
- Never include an AI-attribution trailer: no `Co-Authored-By: Claude ...`, no `Generated with ...`. Strip it if a tool adds one.
- Commit or push only when the user asks.
- Branch first (`feature/<name>`, `fix/<name>`, `chore/<name>`) if the change is non-trivial and you're on `main`.
- Never commit `out/`, `.vite/`, `node_modules/`, `.env`, signing certificates, or notarization credentials.
