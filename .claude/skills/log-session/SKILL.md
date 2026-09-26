---
name: log-session
description: Appends this session's entry to agents-build-log.md at low effort, in the format AGENTS.md requires. Use at the end of every working session, after verification.
effort: low
allowed-tools: Bash(date *) Bash(git diff *) Bash(git status *)
---

Append one entry to the end of `agents-build-log.md` for this session. Write it from what you did and verified in this conversation; don't re-read the codebase to write it.

Current UTC time:
!`date -u +%Y-%m-%dT%H:%MZ`

Changes on this branch:
!`git diff --stat main...HEAD`

Uncommitted changes:
!`git status --short`

Use exactly this shape, matching the entries already at the bottom of the file:

```
## [AGENT: Claude] [<UTC time>]
### Action: <one line: what this session did>
### Files changed: <paths, including agents-build-log.md>
### Diff summary: <what changed and why, in 2-4 sentences>
### Verification: <commands run and their results with exact counts; name anything not verified>
### Recommendations / Next steps: <open items, or "None">
```

Only append. Never edit or reorder earlier entries, and leave one blank line before the new header.
