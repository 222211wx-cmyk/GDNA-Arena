# Button

Source: `artifacts/gdna-arena/src/components/ui/button.tsx` (stock shadcn + elevate system, source-identical to this package's `src/components/ui/button.tsx`).

- Variants: `default` (gold on black in dark mode), `destructive`, `outline`, `secondary`, `ghost`, `link`.
- Sizes: `default`, `sm`, `lg`, `icon`.
- `asChild` via radix Slot.
- Uses `hover-elevate` / `active-elevate-2` utilities and `--button-outline` / `--primary-border` computed borders from the theme.
- Empire usage: primary CTAs are gold with black text; secondary actions are near-black surfaces with white text; the app also styles bespoke `.royal-btn` gradients at the app layer (do not port into the package).
