/**
 * chunk.ts — W1040. D1 accepts at most 100 bound parameters in one query. An IN-list built
 * with one "?" per id therefore fails outright past 100 ids (two hunters had more than 300
 * started hunts by 2026-10-11, and the pact queries bound one per hunt). Split the ids and
 * run the query once per slice.
 */
export const D1_SAFE_PARAMS = 90;

export function chunks<T>(items: T[], size: number = D1_SAFE_PARAMS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
