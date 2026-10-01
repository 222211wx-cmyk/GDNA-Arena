---
name: Notification prompt policy
description: No unsolicited global notification activation banners
---

Do not show floating or recurring notification-activation prompts across the site. Keep notification permission citizen-initiated in messaging settings rather than prompting during ordinary browsing.

**Why:** On 2026-09-19 the owner explicitly called the phone-notification activation prompt intrusive and unwanted. Denied, unsupported, and registration-error states must not turn into persistent global reminders.

**How to apply:** Preserve actual incoming-call interfaces, existing opt-in subscriptions, and silent registration diagnostics. Do not interpret removal of the activation banner as disabling calls or notifications that citizens already enabled.

Recovery-code expiry reminders are account-settings consent, not permission to
send notifications elsewhere or to rotate credentials in the background.

**Why:** The recovery reminder request explicitly limits the alert to an optional
settings feature and requires password confirmation before replacement. Extending
that choice to push, email, or automatic renewal would exceed the citizen's consent.

**How to apply:** Keep reminder preferences separate from notification permission
and credential mutations. Any future delivery outside settings needs its own
explicit opt-in; expiry status alone is never authorization to replace a code.