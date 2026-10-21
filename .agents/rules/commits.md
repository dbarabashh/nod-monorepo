---
description: Commit message format, signing, and when to commit.
alwaysApply: true
---

- Write commit messages in all lowercase, max 4–5 words: `add tray menu`, `fix window restore on activate`.
- Never include an AI-attribution trailer: no `Co-Authored-By: Claude ...`, no `Generated with ...`. Strip it if a tool adds one.
- Every commit must be signed. Never pass `--no-gpg-sign`, `-c commit.gpgsign=false`, or anything else that skips or disables signing, and never change the signing config to get a commit through.
- If signing fails (no key, locked agent, missing passphrase), stop and tell the user what failed. Never fall back to an unsigned commit.
- Before pushing, check that the new commits are signed: `git log --show-signature origin/main..HEAD`, or `git verify-commit <sha>` for each one. Never push an unsigned commit.
- Commit or push only when the user asks.
- Branch first (`feature/<name>`, `fix/<name>`, `chore/<name>`) if the change is non-trivial and you're on `main`.
- Never commit build output or secrets: `out/`, `.vite/`, `.dev-electron/`, `ios/`, `android/`, `.expo/`, `dist/`, `node_modules/`, `.env`, keystores, provisioning profiles, signing certificates, or notarization and store credentials.
