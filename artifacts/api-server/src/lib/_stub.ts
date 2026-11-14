// Helper for stub modules that replace files missing from this repository.
// Returns a value that can be called, constructed, and property-accessed without throwing.
export function makeStub(): any {
  const target = function () {} as any;
  return new Proxy(target, {
    get: (t, key) => (key === "prototype" ? t.prototype : key === Symbol.toPrimitive ? () => "" : makeStub()),
    apply: () => undefined,
    construct: () => ({}),
  });
}
