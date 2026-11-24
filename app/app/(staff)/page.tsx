import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, FileText, LoaderCircle } from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { QUEUE_LABELS } from "@/lib/checks";
import { formatDate, KIND_LABELS } from "@/lib/format";
import { listFaxes, summarize } from "@/lib/store";
import { QUEUES, type FaxSummary, type Queue } from "@/lib/types";

const QUEUE_HELP: Record<Queue, string> = {
  review: "Referrals with something to check: a value to confirm, a possible match or duplicate, or an urgency question.",
  needs_info: "Referrals missing something required. Send the drafted request to the referring office.",
  ready: "Complete referrals. Confirm the patient and book the visit.",
  booked: "Referrals with a booked visit.",
  other: "Faxes that are not referrals: pharmacy requests, records, prior auths, junk.",
};

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const user = await requirePageUser();
  const { q } = await searchParams;
  const all = (await listFaxes()).map(summarize);
  const queue: Queue = (QUEUES as readonly string[]).includes(q ?? "") ? (q as Queue) : "review";
  const running = all.filter((f) => f.run.status === "running");
  const rows = all
    .filter((f) => f.queue === queue && f.run.status !== "running")
    .sort((a, b) => (a.urgency.level === b.urgency.level ? b.createdAt.localeCompare(a.createdAt) : a.urgency.level === "urgent" ? -1 : 1));
  const counts = Object.fromEntries(QUEUES.map((k) => [k, all.filter((f) => f.queue === k && f.run.status !== "running").length])) as Record<Queue, number>;
  const urgentOpen = all.filter((f) => f.urgency.level === "urgent" && f.kind === "referral" && f.queue !== "booked").length;

  return (
    <div className="flex flex-col">
      <AutoRefresh active={running.length > 0} />
      <section className="mx-auto flex w-full max-w-[1280px] flex-wrap items-end justify-between gap-6 px-6 pt-10 pb-10">
        <PageHeading before="Fax" highlight="queue">
          Every inbound fax is read, sorted, checked and routed. {urgentOpen ? `${urgentOpen} urgent referral${urgentOpen === 1 ? "" : "s"} not booked yet.` : ""}
        </PageHeading>
        {user.role === "coordinator" ? <ButtonLink href="/faxes/new">Add fax</ButtonLink> : null}
      </section>
      <section className="flex-1 bg-cream">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-10">
          <nav aria-label="Queues" className="flex flex-wrap gap-2 self-start rounded-full border border-fog bg-paper p-1">
            {QUEUES.map((k) => (
              <Link
                key={k}
                href={k === "review" ? "/" : `/?q=${k}`}
                aria-current={k === queue ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-[14px] ${k === queue ? "bg-ink text-paper" : "hover:bg-cream"}`}
              >
                {QUEUE_LABELS[k]} · {counts[k]}
              </Link>
            ))}
          </nav>
          <p className="text-[14px] text-graphite">{QUEUE_HELP[queue]}</p>
          {running.map((f) => (
            <Link key={f.id} href={`/faxes/${f.id}`} className="flex items-center gap-3 rounded-[16px] border border-fog bg-paper p-5 hover:border-silver">
              <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" strokeWidth={1.5} />
              <span className="font-medium">{f.fileName}</span>
              <span className="text-[14px] text-graphite">{f.run.progress ?? "Working"}</span>
            </Link>
          ))}
          {rows.length === 0 ? (
            <div className="rounded-[16px] border border-fog bg-paper p-10 text-center text-graphite">Nothing here.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((f) => (
                <Row key={f.id} f={f} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ f }: { f: FaxSummary }) {
  const urgent = f.urgency.level === "urgent" && f.kind === "referral";
  return (
    <Link
      href={`/faxes/${f.id}`}
      className={`grid gap-3 rounded-[16px] bg-paper p-5 hover:border-silver md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center ${urgent ? "border-2 border-ink" : "border border-fog"}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {urgent ? <AlertTriangle aria-label="Urgent" className="h-5 w-5 shrink-0" strokeWidth={1.5} /> : <FileText aria-hidden className="h-5 w-5 shrink-0" strokeWidth={1.5} />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{f.kind === "referral" ? (f.patientName ?? "Patient name not found") : KIND_LABELS[f.kind ?? "other"]}</span>
          <span className="truncate text-[14px] text-graphite">
            {f.referringPractice ?? f.fromFax ?? "Unknown sender"} · {f.pageCount} page{f.pageCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <span className="text-[14px]">{f.specialty ?? (f.kind === "referral" ? "Specialty not found" : "")}</span>
      <span className="text-[14px] text-graphite">{formatDate(f.createdAt)}</span>
      <span className="flex flex-wrap gap-2">
        {urgent ? <Badge tone="sky">Urgent</Badge> : null}
        {f.run.status === "error" ? <Badge tone="outline">Needs attention</Badge> : null}
        {f.missing ? <Badge>{f.missing} missing</Badge> : null}
        {f.toCheck ? <Badge tone="outline">{f.toCheck} to check</Badge> : null}
        {f.duplicateOf ? <Badge tone="outline">Possible duplicate</Badge> : null}
      </span>
    </Link>
  );
}
