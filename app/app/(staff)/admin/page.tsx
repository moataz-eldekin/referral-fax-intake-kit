import { connection } from "next/server";
import { StaffManager } from "@/components/admin/StaffManager";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { listStaff } from "@/lib/store";

export default async function AdminPage() {
  await connection();
  await requirePageUser("admin");
  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-[1280px] px-6 pt-10 pb-12">
        <PageHeading before="Intake" highlight="staff">
          Coordinators work the shared queue and book visits. The admin view of faxes is read-only.
        </PageHeading>
      </section>
      <section className="bg-cream">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-12">
          <StaffManager initialStaff={await listStaff()} />
        </div>
      </section>
    </div>
  );
}
