"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PAGE_LABELS } from "@/lib/format";
import type { Box, FaxPage } from "@/lib/types";

/** The original fax pages, with the words behind the selected field highlighted. */
export function PageViewer({
  faxId,
  pages,
  current,
  onPage,
  highlight,
}: {
  faxId: string;
  pages: FaxPage[];
  current: number;
  onPage: (n: number) => void;
  highlight: Box[];
}) {
  const page = pages.find((p) => p.n === current) ?? pages[0];
  if (!page) return null;
  const w = page.width || 1700;
  const h = page.height || 2200;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Pages">
        {pages.map((p) => (
          <button
            key={p.n}
            type="button"
            role="tab"
            aria-selected={p.n === page.n}
            onClick={() => onPage(p.n)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${p.n === page.n ? "border-ink bg-ink text-paper" : "border-fog bg-paper hover:bg-cream"}`}
          >
            {p.n}. {p.type ? PAGE_LABELS[p.type] : "Page"}
            {p.typeUnsure ? <AlertTriangle aria-label="Type needs a look" className="h-3.5 w-3.5" strokeWidth={1.5} /> : null}
          </button>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-[16px] border border-fog bg-paper">
        {/* eslint-disable-next-line @next/next/no-img-element -- auth-protected page image */}
        <img src={`/api/faxes/${faxId}/pages/${page.n}`} alt={`Fax page ${page.n}`} className="block w-full" />
        {highlight.map((b, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-[2px] bg-sky/45 ring-2 ring-sky"
            style={{ left: `${(b[0] / w) * 100}%`, top: `${(b[1] / h) * 100}%`, width: `${((b[2] - b[0]) / w) * 100}%`, height: `${((b[3] - b[1]) / h) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-graphite">
        <Badge tone="outline">OCR confidence {page.confidence || "n/a"}</Badge>
        {page.typeEvidence ? <span>Sorted from: &ldquo;{page.typeEvidence}&rdquo;</span> : null}
        {page.typeUnsure ? <span>The page type could not be confirmed from the page text.</span> : null}
      </div>
    </div>
  );
}
