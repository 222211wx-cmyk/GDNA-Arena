---
name: Digital folding research boundaries
description: Intent and honest measurement requirements for the user's storage-density research.
---

Treat digital folding as a separate reversible storage experiment, not permission to remove product features or claim the Android startup problem is fixed.

**Why:** The user explicitly clarified the folded-paper and higher-capacity memory-card analogy as a genuine search for more efficient representation without losing original content.

**How to apply:** Include all dictionaries, references and metadata in size accounting, disclose any excluded decoder/runtime, compare to a standard compression baseline, and verify exact reconstruction. Distinguish hardware density, transfer size, installed size and runtime memory. Never describe a custom compressed archive as a directly installable APK or promise universal tenfold lossless compression.

Research tool availability needs more than a PATH check in this environment.

**Why:** A prior compression run reported Zstandard unavailable from PATH, although a usable CLI was already present among transitive system dependencies. Installing another copy would unnecessarily affect application workflows.

**How to apply:** Before declaring a comparator unavailable, check existing dependency closures. Expose an available executable only to the research command, record its version and resolved path, and avoid changing app dependencies or restarting services for compression research.