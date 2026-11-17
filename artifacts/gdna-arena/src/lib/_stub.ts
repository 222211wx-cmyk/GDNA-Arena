// Shared helper for placeholder modules whose real implementation is missing from the repository.
type Cb = (...args: any[]) => any;
export type StubFn = (...args: Array<Cb | {} | null | undefined>) => any;

export function stub(name: string): StubFn {
  return () => {
    console.warn(`[stub] ${name} called but not implemented`);
    return undefined;
  };
}
