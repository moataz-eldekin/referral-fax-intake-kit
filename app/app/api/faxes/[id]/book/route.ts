import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { refresh } from "@/lib/checks";
import { errorResponse, readJsonBody } from "@/lib/http";
import { findSlot } from "@/lib/slots";
import { addAppointment, getPatient, listAppointments, listFaxes, listPatients, removeAppointment, updateFax } from "@/lib/store";

/** POST /api/faxes/:id/book (coordinator): {slotId} books the visit for the matched patient. */
export async function POST(request: Request, ctx: RouteContext<"/api/faxes/[id]/book">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  const { fax, user } = access;
  if (fax.kind !== "referral" || !fax.referral) return errorResponse({ title: "Not a referral", message: "Only referrals can be booked." }, 409);
  if (fax.appointmentId) return errorResponse({ title: "Already booked", message: "This referral already has a visit." }, 409);
  const m = fax.match;
  const patientId = m && (m.status === "match" || m.status === "confirmed" || m.status === "created") ? m.patientId : undefined;
  const patient = patientId ? await getPatient(patientId) : undefined;
  if (!patient) return errorResponse({ title: "Confirm the patient first", message: "Confirm the existing patient or create a new one before booking." }, 409);
  const slot = findSlot(String((await readJsonBody(request))?.slotId ?? ""), await listAppointments());
  if (!slot) return errorResponse({ title: "Slot not available", message: "That time is no longer open. Pick another one." }, 409);
  const appt = await addAppointment({
    id: randomUUID(), slotId: slot.id, start: slot.start, minutes: slot.minutes, specialty: slot.specialty, provider: slot.provider,
    patientId: patient.id, patientName: patient.name, faxId: fax.id, bookedBy: user.name, bookedAt: new Date().toISOString(),
  });
  if ("error" in appt) return errorResponse({ title: "Slot taken", message: appt.error }, 409);
  const updated = await updateFax(fax.id, (f) => {
    f.appointmentId = appt.id;
    f.queue = "booked";
    f.history.push({ at: new Date().toISOString(), by: user.name, text: `Booked ${slot.specialty} with ${slot.provider}, ${slot.start.slice(0, 16).replace("T", " ")}` });
  });
  const { raw: _raw, ...out } = updated;
  void _raw;
  return NextResponse.json({ fax: out, appointment: appt });
}

/** DELETE /api/faxes/:id/book (coordinator): cancels the visit and puts the referral back in its queue. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/faxes/[id]/book">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  const { fax, user } = access;
  if (!fax.appointmentId) return errorResponse({ title: "Not booked", message: "This referral has no visit." }, 409);
  await removeAppointment(fax.appointmentId);
  const [patients, others] = await Promise.all([listPatients(), listFaxes()]);
  const updated = await updateFax(fax.id, (f) => {
    f.appointmentId = undefined;
    f.queue = "review";
    f.history.push({ at: new Date().toISOString(), by: user.name, text: "Cancelled the visit" });
    refresh(f, patients, others);
  });
  const { raw: _raw, ...out } = updated;
  void _raw;
  return NextResponse.json({ fax: out });
}
