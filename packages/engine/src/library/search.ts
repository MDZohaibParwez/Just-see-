/**
 * Tiny, dependency-free search used by the asset library. Scores a query
 * against item text: exact word > prefix > substring, every query word must
 * match something. Case and accents are ignored.
 */
export interface Searchable {
  label: string;
  tags?: readonly string[];
  kind?: string;
}

const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function tokenize(s: string): string[] {
  return norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** 0 = no match. Higher is better. */
export function scoreItem(query: string, item: Searchable): number {
  const q = tokenize(query);
  if (q.length === 0) return 1;
  // Joined forms too, so "lofi" finds "Lo-fi" and "badumtss" finds "Ba-dum-tss".
  const joined = [item.label, ...(item.tags ?? [])].map((x) => norm(x).replace(/[^\p{L}\p{N}]+/gu, ""));
  const words = [...tokenize(item.label), ...(item.tags ?? []).flatMap(tokenize), ...(item.kind ? tokenize(item.kind) : []), ...joined];
  const label = norm(item.label);
  let total = 0;
  for (const qw of q) {
    let best = 0;
    for (const w of words) {
      if (w === qw) best = Math.max(best, 10);
      else if (w.startsWith(qw)) best = Math.max(best, 6);
      else if (qw.length >= 3 && w.includes(qw)) best = Math.max(best, 3);
      else if (qw.length >= 4 && w.length >= 4 && (qw.startsWith(w) || editDistance1(w, qw))) best = Math.max(best, 2);
    }
    if (best === 0) return 0;
    total += best;
  }
  if (label.startsWith(norm(query).trim())) total += 5;
  return total;
}

/** True when a and b differ by at most one edit (typo tolerance). */
function editDistance1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function searchItems<T extends Searchable>(query: string, items: readonly T[], limit = 200): T[] {
  return items
    .map((item, i) => ({ item, i, s: scoreItem(query, item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}
