/**
 * Records every property set + method call on a mock 2D context, so the draw
 * functions can be asserted without a real canvas.
 */
export function mockCtx(): {
  ctx: CanvasRenderingContext2D;
  sets: Record<string, unknown>;
  calls: string[];
} {
  const sets: Record<string, unknown> = {};
  const calls: string[] = [];
  const gradient = { addColorStop: () => calls.push('addColorStop') };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'createRadialGradient') return () => gradient;
        if (prop === 'measureText') return () => ({ width: 12 });
        return (..._args: unknown[]) => {
          calls.push(prop);
          return undefined as unknown;
        };
      },
      set(_t, prop: string, value: unknown) {
        sets[prop] = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, sets, calls };
}