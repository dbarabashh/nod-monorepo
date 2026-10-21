---
description: Don't write comments; the rare exception is a non-obvious WHY.
globs: '*.ts, *.tsx, *.mts, *.css, *.html'
alwaysApply: true
---

- Don't write comments. Code explains itself through good names, small functions, and precise types.
- Never add narration that restates the next line, banner headers, file-header docblocks, or task/author references (`// TODO`, `// added for #14`).
- Never leave commented-out code or template boilerplate comments. Delete them; git remembers.
- The only exception is a non-obvious WHY the code cannot express: a platform quirk (an Electron or React Native behavior specific to one OS), an upstream-bug workaround, or a security reason a setting must stay as it is.
- Tool directives the toolchain needs (`oxlint-disable-next-line`, `@ts-expect-error`) are allowed and must be as narrow as possible.
