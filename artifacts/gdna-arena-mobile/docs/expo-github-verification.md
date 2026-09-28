# Expo–GitHub verification — 2026-09-28

## Verified external state

These are live API observations, not conclusions drawn from a local CLI upload.

- Expo project: `1b27129b-6f98-4704-8a45-efe06a2a2856`
  (`@qaisypro2024/gdnaarena`).
- After owner authorization, Expo's project API returned
  `githubRepository.githubRepositoryUrl` =
  `https://github.com/222211wx-cmyk/gdna-arena-mobile`
  and repository identifier `1389492488`.
- `githubRepositorySettings.baseDirectory` returned
  `/artifacts/gdna-arena-mobile`. Build requests explicitly use the
  repository-relative form `artifacts/gdna-arena-mobile`.

The earlier observation of no repository/installation was **before** the owner
completed authorization; it is no longer the current linkage state.

## Remote merges

All changes used GitHub PR merge operations guarded by the expected head SHA.
No force-push, remote-tree replacement, or branch deletion was used.

1. [Source synchronization PR](https://github.com/222211wx-cmyk/gdna-arena-mobile/pull/1)
   was verified merged into `main`, merge commit
   `88a5779b1d15c2e3a888f37f3f89b124624494ac`.
2. [Android build image PR](https://github.com/222211wx-cmyk/gdna-arena-mobile/pull/2)
   was merged as `02e2f30eea211aafc183f621e5ca32268b188564`.
   It adds `build.preview.android.image: latest`; production inherits preview.
3. [Required font patch PR](https://github.com/222211wx-cmyk/gdna-arena-mobile/pull/3)
   was merged as `8b239f0f6f2ff981cb028430947d9e94403d16c6`.
   It adds the existing local `patches/expo-font@14.0.12.patch` to GitHub.
   The remote workspace configuration already referenced this file, but the
   file itself had not been synchronized.

## GitHub-sourced build evidence

The Expo GitHub build operation (not EAS CLI upload) was invoked with Android,
profile `preview`, the exact merged commit, and `autoSubmit: false`.

- First build: `9a48d47c-f935-412e-897d-751683b7a406`, commit
  `02e2f30eea211aafc183f621e5ca32268b188564`.
  Its worker logs read the mobile package manifest and recognized all 11
  workspace projects. This proves Expo obtained the private repository source.
  Dependency installation then failed with ENOENT for the missing font patch.
  This was a repository-content failure, not an authorization failure.
- After adding the patch through PR 3, a new GitHub build was accepted:
  `67e9c2ca-acd9-4cd7-a2f4-5ba043736bb9`, commit
  `8b239f0f6f2ff981cb028430947d9e94403d16c6`.
  Initial status: queued.

[Latest build](https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/67e9c2ca-acd9-4cd7-a2f4-5ba043736bb9)

The local EAS JSON configuration and `git diff --check` passed. No app UI or
runtime behavior was changed. A queued build is not a successful APK, store
submission, or physical-device call verification; check the live build page
for its eventual outcome.