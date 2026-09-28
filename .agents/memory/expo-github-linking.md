---
name: Expo GitHub linking
description: Distinguish CLI uploads, Replit GitHub access, and Expo repository authorization.
---

Treat Expo's repository connection as independent from Replit's GitHub connection and successful EAS CLI uploads.

**Why:** A linked GitHub user and successful signed Android builds coexisted with no repository or GitHub App installation associated with the Expo owner account. Neither proves that Expo can fetch the private repository.

**How to apply:** Check Expo's project repository and owner-account installation directly before triggering a GitHub-sourced build. If the installation is absent, have the owner authorize the Expo GitHub App and select the repository in Expo's project GitHub settings. Preserve the monorepo base directory and check the documented build-image prerequisite in the remote EAS profile. Merge through PRs rather than replacing remote trees.

Source synchronization must include files referenced by workspace manifests and lockfiles, not only mobile source directories.

**Why:** The first genuine GitHub-sourced build fetched the private repository successfully but could not install dependencies because a referenced pnpm patch existed locally and not remotely.

**How to apply:** Check that every referenced patch exists in the remote commit before building. Distinguish source-fetch success from dependency installation and native compilation; a failed later phase does not mean the GitHub authorization failed.