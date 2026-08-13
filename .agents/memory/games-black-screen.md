---
name: Games black-screen report
description: Owner's recurring complaint about game buttons blocking after login; status and diagnosis
---

- Owner (on PC) reported: after login, game PLAY buttons show a "black blocked screen" with only the WhatsApp float visible, forcing him to leave the site.
- E2E test (logged in as test citizen) could NOT reproduce in dev: PLAY opens a proper result modal (recoverable via X), tournament opens a visible modal with the red ❌ الخروج exit button.
- Most likely cause: he was on the PUBLISHED production build, which predates the GameExitButton + fixes. **How to apply:** when he reports a bug that dev can't reproduce, check whether production has been republished since the fix before debugging further.
- Games tab safety features now in dev: fixed red exit button top-left on GlobalStar + tournament, 30s-idle exit confirmation dialog (GameExitButton component).
