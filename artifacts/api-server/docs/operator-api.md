# Operator and science API — implemented backend contract

All paths are under `/api`. No signed partnerships exist. Prices and `*6#` are
user-supplied, unverified indications; the code is display-only, never a `tel:`
purchase action. GDNA is not claimed to be included in restricted bundles.
Citizens pay operators directly. Affiliate commission requires a real agreement;
there is currently none. No recruitment rewards, pyramid or levels.

- `GET /operators/packs`: `{packs:[{id,name,priceMad,priceStatus:"unverified",dialCode:"*6#",dialCodeVerified:false,officialUrl,partnershipStatus:"not_signed"}],disclaimer,privacy}`.
  IDs are `inwi`, `orange`, `itissalat`; indicative prices 20, 29, 25 MAD.
- `POST /operators/referral`: strict `{source:"inwi"|"orange"|"itissalat"|"star6",eventId:UUID}`.
  Returns `{accepted:true,duplicate:boolean}`. First source per session wins.
  This neither verifies nor provisions a pack and creates no commission.
- `POST /operators/measure`: strict single object `{eventId:UUID,surface:"lite"|"clips"|"citizens"|"market"|"profile"|"chat",outcome:"success"|"failure"|"cache",observedBytes:integer(0..52428800),clipId?:positiveInteger}`.
  Returns `{accepted:true,duplicate:boolean}`. Cookie session is established on
  first valid submission; logged-in samples also contribute to the citizen month.
  Bytes and outcomes are explicitly client-reported, not independently verified.
  Never submit originalBytes/alternativeBytes/URL/identity. Optional clipId is only
  for an actual audio download on a clip/lite surface, not list/card/predictor views.
  Avoided-byte estimates require success, exact observed audio size, and a
  matching one-use same-session server receipt created after the full audio
  response finishes. Failure, cache, partial/range responses, absent receipts,
  predictions, and list views produce no avoided-byte estimate. Sizes come from
  server original + ready derivative metadata, never client-selected baselines.
  Server send completion does not prove reception/listening; estimates remain
  estimates. Already-replaced originals without comparable metadata are excluded.
- `GET /operators/science`: requires login. `{month,measuredPayloadBytes,
  estimatedAvoidedBytes,observedRequestSuccessScore,sampleSize,comparisonSampleSize,
  measurementStatus:"client-reported-not-verified",methodology}`.
  UTC calendar month, score fraction 0..1 or null without samples. Offline-cache
  counts as observed success, not avoided bytes. Not uptime/carrier reliability.
- `GET /partners/stats`: `{period:"last_30_days",privacyThreshold:10,suppressed,
  authenticatedCitizens:number|null,anonymousReferrals:number|null,methodology,
  measuredPayloadBytes:number|null,estimatedAvoidedBytes:number|null,
  sampleSize:number|null,comparisonSampleSize:number|null,
  observedRequestSuccessScore:number|null,scienceSuppressed:boolean,
  measurementStatus:"client-reported-not-verified",comparisonBaseline:"same_clip_original",
  scienceMethodology:string}`.
  Both counts are suppressed if total or any nonzero subgroup is below ten.
  Global science aggregates include only measurement events in the last 30 days
  (with or without referral). All numeric science fields are null unless both
  the visitor threshold and a separate threshold of ten measurement contributors
  pass; each nonempty authenticated/anonymous contributor subgroup must also
  reach ten. Score remains null when no samples. It is observed sampled request
  success including offline cache, never uptime or carrier/network performance.
  No public source breakdown, contacts, citizen names, or individual events.
- `GET /partners/dashboard`: login plus administrator authorization. Same totals
  without suppression plus `sources:[{source,authenticatedCitizens,anonymousReferrals,
  measuredPayloadBytes,estimatedAvoidedBytes,sampleSize,comparisonSampleSize,
  observedRequestSuccessScore,measurementStatus,comparisonBaseline,scienceMethodology,
  period,attributionMethodology}]`
  and latest 100 `inquiries:[{id,company,contactEmail,message,consent,createdAt}]`.
  All four allowed sources appear, including real zero/null empty states. Source
  science aggregates include only same-session measurements at/after first-source
  attribution, where both event and attribution are within the last 30 days.
  Pre-referral browsing is not assigned retroactively. Visitor counts are computed
  separately to avoid multiplying counts by event volume. Source sample totals
  need not equal global samples (unattributed/earlier measurements are excluded).
  Baseline means the same clip's original, never Facebook or another platform.
- `POST /partners/contact`: strict `{company:string(2..120),contactEmail:string,
  message:string(10..3000),consent:true,website?:string}`. Honeypot must be empty.
  Returns 201 `{received:true,emailSent:false}` only after real persistence.

Errors: 400 validation; 401 login; 403 administrator/origin; 404 inaccessible
clip; 429 quota; 503 storage unavailable. Mutations enforce same-origin when
Origin is supplied and reject cross-site Fetch Metadata. No paid AI is called.

Daily durable UUID dedupe scopes to session + event kind. Atomic quotas: 1000
measurements/session/day, 20 referral attempts/session/day, 3 contacts/session/day
and 10 contacts/hashed-IP/day. Duplicate events do not consume daily quota.
First attribution is immutable; anonymous sessions can be associated with a
logged-in citizen on a later event. Citizens deduplicate across sessions; anonymous
cookies are not verified people. Source totals may overlap for citizens.

Existing HttpOnly SameSite cookie identifies sessions; analytics store a SHA-256
session identifier, never URLs/names. Analytics expire after 90 days, inquiries
after 180 days via activity-driven daily cleanup. One-use audio receipts are
eligible for 24 hours and purged on daily cleanup (at most ~48h on active service).
Inactive services purge expired data on next API activity. Public queries exclude
expired records even before cleanup. Inquiries are for administrator review;
no email delivery is claimed.

`lib/gdna-data-science.ts` provides a pure local bitrate × duration predictor
with dimension scaling. Estimates vary with inputs, not AI, guaranteed quality,
actual measured savings, or comparisons to Facebook/other platforms.

Development schema: `NODE_ENV=development node lib/db/scripts/push-operators-additive.mjs`.
It is additive only and rejects deployments. Production uses Replit Publish,
never application startup DDL or push-force.