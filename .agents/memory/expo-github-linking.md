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

EAS builder upgrades can invalidate pnpm dependency-script approval settings even when the frozen lockfile is unchanged.

**Why:** The moving Android `latest` image used pnpm 11, which removed `onlyBuiltDependencies`; scripts previously approved in pnpm 10 became unreviewed and installation failed. `allowBuilds` works with both pnpm 10.26+ and pnpm 11.

**How to apply:** Check the actual builder pnpm version and test a clean frozen install with it. Preserve strict rejection of unreviewed scripts and minimum release age; do not disable security checks to make a build pass. Distinguish necessary native installers from optional install-time configuration or advisory scripts.

Repository write access does not establish permission to update GitHub Actions workflows.

**Why:** The connected OAuth credential could create SDK migration blobs and a source-only tree, but rejected the same tree with a workflow update. The reauthorization scope inventory offered `repo`, not `workflow`.

**How to apply:** Diagnose workflow writes separately from source writes. Do not bypass missing workflow permissions through alternate Git endpoints, or push a partial SDK migration that leaves an incompatible build workflow on main. Request an authorized workflow update before publishing the coherent migration.