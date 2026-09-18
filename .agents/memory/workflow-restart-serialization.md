---
name: Workflow restart serialization
description: Shared workflow lifecycle races observed when restarting this multi-artifact workspace
---

Restart artifact services serially rather than concurrently.

**Why:** Parallel restarts repeatedly returned success while leaving duplicate service processes, occupied ports, and failed workflow records. Clearing verified orphan service process groups and restarting each service serially restored all workflows.

**How to apply:** Treat workflow lifecycle calls as shared-state operations, even for different artifacts. If a restart reports success but later logs show an occupied port, inspect current listeners and process ownership before retrying. Only terminate verified orphan service groups; never broadly kill Node processes or change ports to hide the collision.