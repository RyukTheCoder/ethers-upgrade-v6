---
name: "eth-upgrade-v6"
description: "An automated codemod to migrate ethers.js v5 to v6"
allowed-tools:
  - Bash(codemod *)
---

# eth-upgrade-v6

codemod-compatibility: skill-package-v1
codemod-skill-version: 0.1.0

Use `references/index.md` as the primary instruction index for this package.

## Execution Contract

1. Load package-specific guidance from `references/index.md`.
2. Apply the package strategy to the current repository context using Codemod CLI commands.
3. Report what changed, what was skipped, and any manual follow-ups.
