import { Guidelines, Stack } from './parts';

export function BrandPage() {
  return (
    <Stack>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Logo</h2>
        <p className="text-sm text-muted-foreground">
          The GDNA crown mark — flat imperial gold on pure black with a dashed
          orbital ring. Use it on black surfaces only; never recolor the crown.
        </p>
        <div className="flex items-center gap-6">
          <div className="rounded-xl border p-6 bg-black">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="GDNA crown logo" className="h-20 w-20" />
          </div>
          <div className="rounded-xl border p-6" style={{ background: '#0d0d0d' }}>
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="GDNA crown logo on card surface" className="h-12 w-12" />
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Empire style rules</h2>
        <Guidelines
          items={[
            { kind: 'do', text: 'Treat dark mode as the canonical mode — Arena Qaisypro is a dark-first product on pure black (#000).' },
            { kind: 'do', text: 'Reserve imperial gold (#C9A84C) for primary actions, ranks, and royal emphasis; use thin gold-tinted borders to frame surfaces.' },
            { kind: 'do', text: 'Use neon blue (#00d4ff) sparingly as a tech/energy accent (links, highlights, charts), never as a competing primary.' },
            { kind: 'do', text: 'Support RTL layouts — Arabic/Darija is a first-class language of the empire.' },
            { kind: 'dont', text: 'Do not put gold text on gold surfaces or white on gold — gold pairs with black text.' },
            { kind: 'dont', text: 'Do not introduce new hues; stay within gold, neon blue, victory green, and the semantic red.' },
            { kind: 'dont', text: 'Do not overuse glow effects — gold glows mark featured or live content only.' },
          ]}
        />
      </section>
    </Stack>
  );
}
