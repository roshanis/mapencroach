// Shared helper for reading a filter's initial value from the URL. Used by
// AlertsTable (tier/status) and CasesTable (workflow bucket) so an
// unrecognized or hand-edited query param (e.g. `?tier=bogus`) falls back
// cleanly to "all" instead of producing a blank <select> and a filtered-to-
// zero table with no indication anything was wrong.

/**
 * Returns `value` if it is one of `options`, otherwise `"all"`. `options`
 * must include `"all"` itself for the type to line up with the state it
 * seeds.
 */
export function parseFilterParam<T extends string>(
  value: string | null,
  options: readonly T[]
): T {
  if (value !== null && (options as readonly string[]).includes(value)) {
    return value as T;
  }
  return "all" as T;
}
