# Offline account ownership recovery

## Ownership policy

Recovery is separate from persistent username/password sign-in. A username is
never ownership proof. This flow does not introduce email, SMS, Firebase or a
support-agent override. Existing optional phone recovery is a separate feature.

While signed in, the citizen supplies the current password to issue, replace or
remove a recovery code. The server checks the password against a locked current
credential record and a live session. Generation is an explicit citizen action;
the server uses a cryptographically secure 256-bit random value, rather than
letting a citizen choose a guessable phrase.

One code is active per account, for one year. Replacing it immediately invalidates
the old code. Plaintext is returned once in a no-store response, kept transiently
in the UI, and must be retained outside the device. Status never returns it.
Only a domain-separated SHA-256 digest is stored; this is appropriate for random
256-bit material, unlike a human password. Passwords continue to use bcrypt.

Anyone holding the code can recover the account; keep it private. A missing or
lost issuance response requires re-verification and a new code. A missing reset
response may mean the code was already consumed: try ordinary sign-in using the
new password. Without a previously retained code or another already configured
ownership mechanism, there is no username-only recovery.

## Redemption and revocation

The public endpoint takes the code and new password, not an asserted account ID.
All invalid, expired and consumed proofs receive the same rejection. Rate limits
use durable, keyed subject digests, with IP, authenticated-user and code buckets.
Mutation endpoints require JSON and enforce trusted browser origins. Native
clients use the same cookie-authenticated API.

Inside one PostgreSQL transaction, redemption locks the E2EE registration set,
locks the owner, rechecks and consumes the code, changes the password, increments
the credential generation, removes all app sessions and local push/device public
key registrations, appends a non-secret audit event, and enqueues provider cleanup.
A failed transaction leaves the code usable. No replacement login session is
issued; the citizen returns to ordinary sign-in.

Session storage, credential writers, push enrollment and E2EE enrollment are
fenced against concurrent revocation. WebSocket inbound/outbound authorization
uses canonical session state across replicas. Recovery only disconnects sockets
for the recovered identity; it does not sign out an unrelated current account.

Firebase mirror cleanup cannot be atomic with PostgreSQL. A durable pending row
blocks new provider enrollment and is retried after restarts. Provider generation
fences prevent delayed older mirror writes from undoing revocation. A successful
reset reports `revocationPending` honestly if provider confirmation fails; ordinary
login still works. Already delivered notifications and downloaded data cannot be
recalled. Provider-issued access is not claimed revoked before confirmation.

## Data and encryption boundaries

Recovery updates access credentials, not account ownership or balances. It does
not create a replacement account, reset free-message counters/subscriptions,
delete conversations, or modify message ciphertext/key envelopes. Old private
keys are not backed up by the recovery code. A new device cannot decrypt old
history without the original private keys. Removing public registrations prevents
new messages from targeting those registrations; it cannot erase offline copies
or keys from a lost device.

## Schema rollout and evidence

The additive schema and SQL history are committed in `lib/db`. Apply the reviewed
development changes through the project database workflow, then let Replit Publish
manage production schema promotion. Never put this migration in application startup
or a production deploy hook. Existing credential generations default to zero, so
unexpired legacy sessions are not deliberately signed out by the schema addition.

Per owner instruction, no functional, browser-interaction, concurrency or native
device recovery tests were run for this implementation. Startup compilation and
public-page screenshots are not evidence of successful recovery or historical
message decryption. Do not describe those outcomes as tested.