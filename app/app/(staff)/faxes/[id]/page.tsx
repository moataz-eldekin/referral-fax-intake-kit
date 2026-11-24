import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FaxView } from "@/components/fax/FaxView";
import { requirePageUser } from "@/lib/auth";
import { wrapFaxBack } from "@/lib/faxback";
import { getFax, listAppointments } from "@/lib/store";

export default async function FaxPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const user = await requirePageUser();
  const fax = await getFax((await params).id);
  if (!fax) notFound();
  const { raw: _raw, ...view } = fax;
  void _raw;
  const appointment = fax.appointmentId ? ((await listAppointments()).find((a) => a.id === fax.appointmentId) ?? null) : null;
  return <FaxView key={fax.updatedAt} initial={view} canEdit={user.role === "coordinator"} appointment={appointment} faxBackHeader={fax.referral ? wrapFaxBack(fax.referral) : null} />;
}
