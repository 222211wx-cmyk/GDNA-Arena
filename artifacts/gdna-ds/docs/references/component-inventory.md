# Component inventory — Arena Qaisypro Design System

Source: existing workspace app `artifacts/gdna-arena` (dark-only React + shadcn/ui).
The app's `src/components/ui/` library is byte-identical to this package's scaffold
(only the `@/lib/utils` import alias differs), so the scaffold library IS the source
component library — every family below ships the source implementation, themed by
`tokens.json`.

Chunk 1 (pilot) = the app's five most-used families by unique consumer-file count.
All remaining families are chunk 2 (already present verbatim from source; validated
after pilot approval).

| Family | Reference | Deps | Usage (consumer files) | Chunk | Status |
|---|---|---|---|---|---|
| Button | components/button.md | — | 16 | 1 | implemented |
| Card | components/card.md | — | 13 | 1 | implemented |
| Input | components/input.md | — | 7 | 1 | implemented |
| Badge | components/badge.md | — | 5 | 1 | implemented |
| Label | components/label.md | radix-ui label | 4 | 1 | implemented |
| Separator, Tooltip, Toast, Textarea, Skeleton, Dialog + all other stock shadcn families (see `src/components/ui/`) | — (source-identical scaffold) | radix-ui | ≤4 each | 2 | implemented |

## Native families

Expo consumers use the token-only native theme and font hooks. Native Button
(`default`, `secondary`, `outline`, `ghost`, `destructive`; including icon
size), Card, Input, Typography, Badge, Empty, and Spinner families are
implemented under `src/components/native/`. They use React Native primitives
and intentionally do not expose DOM-only states or CSS class names.

Custom app-level styling (not components — recorded as guidelines): `.imperial-gold`
gradient, gold glow keyframes, `.royal-btn`, thin `#C9A84C` borders (see SKILL notes
and preview Guidelines).
