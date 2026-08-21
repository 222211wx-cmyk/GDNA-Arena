---
name: Games age policy
description: Owner-mandated age-access boundary for registration, general platform access, and Games.
---

Registration and every non-game section must remain open to users of every age. Only active game experiences require age 18 or older. Never show the Games warning on the homepage, in the global header, on other sections, or on the Games selection page. Show it only after the user presses a game’s play/start/tournament button, inside the entered game experience. The required Arabic warning is: “هذا القسم يتطلب +18 حسب قوانين بلدك”.

**Why:** The owner explicitly rejected any globally visible or pre-play warning because it creates distrust on first entry and prevents younger citizens from registering or using unrelated parts of the empire.

**How to apply:** Persist date of birth, calculate eligibility on the server, and enforce it independently in every reward-bearing game API. Trigger the UI gate only after a play/start action; existing accounts without a date of birth may provide it then. Never gate non-game routes or the pre-play Games catalog.