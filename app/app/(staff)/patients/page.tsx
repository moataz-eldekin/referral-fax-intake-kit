import Link from "next/link";
import { connection } from "next/server";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { listPatients } from "@/lib/store";

export default async function PatientsPage() {
  await connection();
  await requirePageUser();
  const patients = (await listPatients()).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-[1280px] px-6 pt-10 pb-10">
        <PageHeading before="Existing" highlight="patients">
          Referrals are matched against this list by name and date of birth. In real use this comes from your EHR.
        </PageHeading>
      </section>
      <section className="flex-1 bg-cream">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-6 py-10">
          {patients.map((p) => (
            <div key={p.id} className="grid gap-2 rounded-[16px] border border-fog bg-paper p-5 md:grid-cols-[1fr_1fr_1fr_1fr]">
              <span className="font-medium">{p.name}</span>
              <span className="font-mono text-[14px]">{p.mrn}</span>
              <span>DOB {p.dob}</span>
              <span className="text-graphite">
                {p.fromFaxId ? (
                  <Link href={`/faxes/${p.fromFaxId}`} className="underline underline-offset-4">
                    Created from a referral
                  </Link>
                ) : (
                  "Existing record"
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
