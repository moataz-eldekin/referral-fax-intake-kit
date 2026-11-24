import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { refresh } from "@/lib/checks";
import { errorResponse, readJsonBody } from "@/lib/http";
import { createPatient, getPatient, listFaxes, listPatients, updateFax } from "@/lib/store";

/** POST /api/faxes/:id/patient (coordinator): {action: "confirm", patientId} or {action: "create"}. */
export async function POST(request: Request, ctx: RouteContext<"/api/faxes/[id]/patient">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  const { fax, user } = access;
  const r = fax.referral;
  if (!r) return errorResponse({ title: "No referral", message: "This fax has no referral." }, 409);
  if (fax.appointmentId) return errorResponse({ title: "Already booked", message: "Cancel the visit before changing the patient." }, 409);
  const body = await readJsonBody(request);
  let patientId: string;
  let status: "confirmed" | "created";
  if (body?.action === "confirm") {
    const p = await getPatient(String(body.patientId ?? ""));
    if (!p) return errorResponse({ title: "Not found", message: "That patient does not exist." }, 404);
    patientId = p.id;
    status = "confirmed";
  } else if (body?.action === "create") {
    if (!r.patient.name.value || !r.patient.dob.value) return errorResponse({ title: "Name and date of birth needed", message: "Fill in the patient's name and date of birth first." });
    if (fax.match?.status === "created") return errorResponse({ title: "Already created", message: "A patient was already created from this fax." }, 409);
    const p = await createPatient({ name: r.patient.name.value, dob: r.patient.dob.value, phone: r.patient.phone.value ?? undefined, fromFaxId: fax.id });
    patientId = p.id;
    status = "created";
  } else {
    return errorResponse({ title: "Unknown action", message: "Use confirm or create." });
  }
  const [patients, others] = await Promise.all([listPatients(), listFaxes()]);
  const p = patients.find((x) => x.id === patientId)!;
  const updated = await updateFax(fax.id, (f) => {
    f.match = { status, patientId, candidates: [{ patientId, name: p.name, dob: p.dob, mrn: p.mrn, why: status === "created" ? "New patient created from this fax" : "Confirmed by a coordinator" }] };
    f.history.push({ at: new Date().toISOString(), by: user.name, text: status === "created" ? `Created patient ${p.name} (${p.mrn})` : `Confirmed patient ${p.name} (${p.mrn})` });
    refresh(f, patients, others);
  });
  const { raw: _raw, ...out } = updated;
  void _raw;
  return NextResponse.json({ fax: out });
}
