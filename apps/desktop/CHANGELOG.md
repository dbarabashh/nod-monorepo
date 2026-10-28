# Changelog

What changed in each release of Nod for desktop. `pnpm release <version>`
moves the Unreleased list under the new version, and the release workflow
publishes that section as the release notes.

## Unreleased

- Builds for Intel Macs are made the same way as for Apple silicon.

## 0.1.0 — 2026-10-28

- Nod updates itself on macOS and Windows: a new version downloads in the
  background and installs when Nod restarts, never while you record. On Linux,
  Nod tells you when a new version is out.
- Settings → Updates shows the version you run and lets you turn automatic
  checks off.
