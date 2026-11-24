/**
 * Finding a quoted phrase on a fax page. Shared by the server (checks) and the browser (highlighting).
 *
 * OCR text has small errors (0/O, 1/I/l, 5/S), so matching compares words after
 * folding those look-alike characters, and allows one word in five to differ.
 */
import type { Box, FaxPage, OcrWord } from "./types";

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Folds characters OCR often confuses, and drops punctuation, so "I10" and "110" compare equal. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[o]/g, "0")
    .replace(/[il|!]/g, "1")
    .replace(/[s$]/g, "5")
    .replace(/[b]/g, "8")
    .replace(/[z]/g, "2")
    .replace(/[^a-z0-9]/g, "");
}

function tokens(s: string): string[] {
  return s.split(/\s+/).map(fold).filter(Boolean);
}

/** Where a quote sits among a page's OCR words: the word indexes, or null. */
export function locateQuote(words: Pick<OcrWord, "text">[], quote: string | null | undefined): { from: number; to: number } | null {
  if (!quote) return null;
  const q = tokens(quote);
  if (!q.length || q.join("").length < 3) return null;
  const w = words.map((x) => fold(x.text));
  const allowed = Math.floor(q.length / 5);
  for (let i = 0; i + q.length <= w.length; i++) {
    let misses = 0;
    for (let k = 0; k < q.length && misses <= allowed; k++) if (w[i + k] !== q[k]) misses++;
    if (misses <= allowed) return { from: i, to: i + q.length - 1 };
  }
  // OCR may split or join words differently: compare the run of characters instead.
  const target = q.join("");
  for (let i = 0; i < w.length; i++) {
    let acc = "";
    for (let j = i; j < w.length && acc.length < target.length + 2; j++) {
      acc += w[j];
      if (acc === target) return { from: i, to: j };
    }
  }
  return null;
}

/** Finds a quote on the stated page first, then on any page. */
export function findOnPages(pages: FaxPage[], quote: string | null, page: number | null): { page: number; boxes: Box[] } | null {
  if (!quote) return null;
  const order = [...pages].sort((a, b) => (a.n === page ? -1 : b.n === page ? 1 : a.n - b.n));
  for (const p of order) {
    const hit = locateQuote(p.words, quote);
    if (hit) return { page: p.n, boxes: p.words.slice(hit.from, hit.to + 1).map((x) => x.box) };
  }
  return null;
}

/** True when the value's letters and digits appear in the quote (after folding look-alikes). */
export function valueInQuote(value: string, quote: string): boolean {
  const v = fold(value);
  return v.length > 0 && fold(quote).includes(v);
}

/** Share of the quote's words that appear anywhere among the page's words (after folding look-alikes). */
export function wordCoverage(words: Pick<OcrWord, "text">[], quote: string): number {
  const q = tokens(quote);
  if (!q.length) return 0;
  const on = new Set(words.map((w) => fold(w.text)));
  return q.filter((t) => on.has(t)).length / q.length;
}
