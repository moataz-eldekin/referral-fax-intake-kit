import Link from "next/link";
import { connection } from "next/server";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { formatSlot } from "@/lib/format";
import { listAppointments } from "@/lib/store";

export default async function SchedulePage() {
  await connection();
  await requirePageUser();
  const appts = (await listAppointments()).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-[1280px] px-6 pt-10 pb-10">
        <PageHeading before="Booked" highlight="visits">
          New-patient visits booked from referrals. This is the kit&apos;s simple calendar; connect your scheduling system or EHR for real use.
        </PageHeading>
      </section>
      <section className="flex-1 bg-cream">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-6 py-10">
          {appts.length === 0 ? <div className="rounded-[16px] border border-fog bg-paper p-10 text-center text-graphite">No visits booked yet.</div> : null}
          {appts.map((a) => (
            <Link key={a.id} href={`/faxes/${a.faxId}`} className="grid gap-2 rounded-[16px] border border-fog bg-paper p-5 hover:border-silver md:grid-cols-[1fr_1fr_1fr_1fr]">
              <span className="font-medium">{formatSlot(a.start)}</span>
              <span>{a.patientName}</span>
              <span>{a.specialty}</span>
              <span className="text-graphite">
                {a.provider} · booked by {a.bookedBy}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
