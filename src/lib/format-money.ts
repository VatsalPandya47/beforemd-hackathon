/** Money formatting, in its own module so the client can import it without
 *  pulling lib/cost-estimate.ts — and its demo-fixtures dependency — into the
 *  browser bundle. */

export function formatCents(cents: number | null): string {
  if (cents === null) return "Unknown";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Whole dollars for headline figures — "$70", not "$70.00". */
export function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export function formatPercent(rate: number | null): string {
  if (rate === null) return "Unknown";
  return `${Math.round(rate * 100)}%`;
}
