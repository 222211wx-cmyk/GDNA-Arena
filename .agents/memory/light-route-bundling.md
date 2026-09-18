---
name: Light route bundling
description: Avoid hidden Vite preloads when separating Clips from the full Arena application
---

Use separate control-flow branches for a lightweight route's dynamic import and the full application's dynamic import. Verify actual browser requests, not just individual bundle sizes.

**Why:** Vite merged the preload dependency lists of imports inside a conditional expression. The nominally tiny Clips branch downloaded the full App stylesheet and became interactive much later on the requested 13.7 KB/s connection. Distinct branches kept the heavy CSS confined to the App route.

**How to apply:** Check emitted preload dependency maps and run a cold production-build network measurement after bootstrap changes. Include service-worker prefetch and fonts in the network budget. First visible HTML and full interactivity are separate metrics; a fast loading label alone does not prove the uploader is ready.