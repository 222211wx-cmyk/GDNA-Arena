---
name: Global back navigation
description: Owner scope for back navigation across sections and in-section searches.
---

Provide persistent back and forward actions everywhere in the web product, including in-section searches, not only between routes.

**Why:** The owner explicitly requested all locations, including navigation between sections and searching inside a section. The supplied Next.js snippet represented intended behavior, not permission to migrate the Vite application.

**How to apply:** Close the active search or nested view before leaving its section. Preserve URL-driven search history and handle direct launches. Keep React and lightweight Clips/Lite shells covered without forcing React into the lightweight entry points. Preserve Agora and unrelated application behavior.

Keep global navigation in reserved layout space; never cover or remove existing section controls, especially the Clips three-line menu.

**Why:** The owner reiterated that both navigation directions are required and reported the Clips menu missing after a fixed back button covered it.

**How to apply:** Preserve the menu and its behavior, reserve space in fixed media shells, and make local back steps reversible where the state remains available.