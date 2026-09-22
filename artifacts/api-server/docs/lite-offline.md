# GDNA Lite — offline queue & snapshot contract

Owned by the Lite frontend agent (`artifacts/gdna-arena/src/lite/offline-queue.ts`).
This document is the **early contract** the infrastructure / SW owner and the
`lite-api` backend agent need to coordinate background sync and the `clientMessageId`
send field. Nothing here bypasses E2EE.

## IndexedDB databases (account-scoped)

Lite stores private data in IndexedDB keyed by the signed-in account id. **Every
database name is suffixed with the account id** so two accounts on one device never
share state, and everything for an account is dropped on logout / account change.

### 1. Outbound message queue — `gdna-lite-queue:<accountId>`

- Store `outbox`, keyPath `clientMessageId` (UUID v4, generated client-side).
- Record shape:

  ```ts
  {
    clientMessageId: string;   // UUID, also sent to the API as the idempotency key
    accountId: number;         // owner; must match the signed-in user before send
    roomId: number;
    ciphertext: string;        // ALWAYS the "e2e:v1:" envelope. NEVER plaintext.
    recipientFingerprints: string[]; // devices the ciphertext was sealed for
    createdAt: number;
    status: "pending" | "sending" | "needs-review";
    lastError?: string;
    attempts: number;
    sendingSince?: number;   // lease timestamp; reclaimed after 60s (crashed tab)
  }
  ```

- **Lease recovery.** A record moves to `sending` with `sendingSince` set before its
  POST. If the tab crashes mid-send, the record is stuck; after `SENDING_LEASE_MS`
  (60s) it is reclaimed as drainable. Re-sending is safe because the server keys on
  `clientMessageId` and returns a replay instead of duplicating.

- A record is enqueued **only after** the message body is encrypted with the sender's
  existing E2EE identity for **valid, known recipient devices**. Plaintext message
  bodies are never written to disk or sent to any endpoint.

### 2. Read snapshots — `gdna-lite-snapshot:<accountId>`

- Store `snapshots`, keyPath `key` (e.g. `citizens`, `market`, `profile:<username>`,
  `room:<id>`). Value: `{ key, data, savedAt }`. Read-only fallback when the network
  read (retry ≤3, exponential + jitter) ultimately fails. Message snapshots store the
  **ciphertext** only; decryption happens locally via the existing E2EE library.

## Sending & sync

- `POST /api/messages/rooms/:id/send` carries `content` (the E2E envelope),
  `type:"text"`, optional **`clientMessageId`** (UUID, sender-scoped idempotency key),
  and **`expectedSenderId`** (the queue's `accountId`). Lite re-sends the identical
  stored bytes; it never re-encrypts a retry.
- **`expectedSenderId`.** Guards the account-switch race between the auth check and the
  POST: the **server must reject** (409/403) if the live session's user differs from
  `expectedSenderId`. Lite also re-verifies the live account before every queued send,
  but the client check alone cannot close the window — the server field is the
  authority. (Backend relay: enforce this.)
- **Replay semantics.** Fresh send → `201 {message,xpEarned}`. Replay of the same
  `clientMessageId` → `200 {replayed:true,xpEarned:0, id: <original>}`, no second
  notification/XP. Both are treated as success and the record is removed.
- **410 Gone.** If the original was deleted/expired, retry returns `410`; Lite drops
  the record rather than resurrecting it.
- **Key-change / mismatch 409.** On `409` (device keys changed, member not enabled,
  or sender mismatch) Lite marks the record `needs-review` and prompts for explicit
  re-encryption. It does **not** auto-resend, re-encrypt silently, or send under a
  different signed-in account.
- **Recipient not set up.** If a recipient has no registered device key, Lite refuses
  to queue and tells the user to **connect once online first** to exchange keys.

## SW coordination (infrastructure owner)

- To trigger a drain, post `{ type: "gdna-lite-sync" }` to clients, or fire a Background
  Sync `sync` event with tag `gdna-lite-outbox`. Lite also drains on the `online`
  event and on mount.
- The SW must **not** cache private API responses or the message send endpoint.

## Lifecycle

- On logout or a detected account change, Lite deletes both databases for the previous
  account id and clears in-memory private state.
