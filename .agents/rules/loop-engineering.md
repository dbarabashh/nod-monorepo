---
description: Require independent review loops before handing off material changes.
alwaysApply: true
---

- For every material or risky change, separate implementation from review and use an independent reviewer that did not author the change.
- Use independent subagents when delegation is available; otherwise run a fresh adversarial review pass with separate context.
- Repeat `review → fix → re-review` until no blocker or high-severity findings remain.
- Run at least two independent review passes for cross-repository, security, privacy, authorization, data-contract or production-infrastructure changes.
- Give reviewers the requirements, raw diff and test evidence, and ask them to find defects rather than confirm the intended design.
- Verify every finding against the implementation, fix confirmed defects and add regression coverage when practical.
- Do not call work ready, push final updates or deploy until the final independent pass and proportional end-to-end verification are clean.
- Report the review rounds, findings fixed, verification evidence and any remaining risk in the handoff.
