---
name: Global back navigation
description: Owner scope for back navigation across sections and in-section searches.
---

Provide a persistent back action everywhere in the web product, including in-section searches, not only between routes.

**Why:** The owner explicitly requested all locations, including navigation between sections and searching inside a section. The supplied Next.js snippet represented intended behavior, not permission to migrate the Vite application.

**How to apply:** Close the active search or nested view before leaving its section. Preserve URL-driven search history and handle direct launches. Keep React and lightweight Clips/Lite shells covered without forcing React into the lightweight entry points. Preserve Agora and unrelated application behavior.