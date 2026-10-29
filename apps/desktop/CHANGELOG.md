# Changelog

What changed in each release of Nod for desktop. `pnpm release <version>`
moves the Unreleased list under the new version, and the release workflow
publishes that section as the release notes.

## Unreleased

- Nod keeps its data in a folder of its own, apart from the earlier Nod app
  for Mac, and moves what it already saved there on its first start.
- On a Mac, test copies of 0.1.1 don't update to this version: install it
  again from the release, and allow Nod to use the microphone and its
  keychain item when macOS asks.
- Summaries are written in the language of the meeting more reliably.
- More summary models to choose from, from Qwen3.5 2B for older computers
  to Gemma 4 26B for those with 24 GB of memory. With several downloaded, pick
  the one Nod uses with Use.

## 0.1.1 — 2026-10-28

- Builds for Intel Macs are made the same way as for Apple silicon.

## 0.1.0 — 2026-10-28

- Nod updates itself on macOS and Windows: a new version downloads in the
  background and installs when Nod restarts, never while you record. On Linux,
  Nod tells you when a new version is out.
- Settings → Updates shows the version you run and lets you turn automatic
  checks off.
