import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { FIELD_KINDS, FIELD_PATHS, formatProblem, getField, labelOf, refresh } from "@/lib/checks";
import { errorResponse, readJsonBody } from "@/lib/http";
import { listFaxes, listPatients, updateFax } from "@/lib/store";

/**
 * PATCH /api/faxes/:id/fields (coordinator)
 *   {path, value}         correct a field (the value read from the fax is kept)
 *   {path, confirm: true} mark a "check" field as right after looking at the page
 * Then matching, urgency, checks and the queue are worked out again.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/faxes/[id]/fields">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  const { fax, user } = access;
  if (!fax.referral) return errorResponse({ title: "No referral", message: "This fax has no referral fields." }, 409);
  if (fax.appointmentId) return errorResponse({ title: "Already booked", message: "Cancel the visit before changing the referral." }, 409);
  const body = await readJsonBody(request);
  const path = String(body?.path ?? "");
  const valid = (FIELD_PATHS as readonly string[]).includes(path) || /^diagnoses\.\d{1,2}\.(code|description)$/.test(path);
  if (!valid || !getField(fax.referral, path)) return errorResponse({ title: "Unknown field", message: "That field does not exist." });
  const confirm = body?.confirm === true;
  let value: string | null = null;
  if (!confirm) {
    value = String(body?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || null;
    if (path === "urgency" && value && !["routine", "urgent", "stat"].includes(value)) return errorResponse({ title: "Check the value", message: "Urgency is routine, urgent or stat." });
    if (path === "patient.dob" && value && formatProblem(value, "dob")) return errorResponse({ title: "Check the value", message: "Enter the date of birth as YYYY-MM-DD." });
  }
  const [patients, others] = await Promise.all([listPatients(), listFaxes()]);
  const updated = await updateFax(fax.id, (f) => {
    const field = getField(f.referral!, path)!;
    if (confirm) {
      if (!field.value) return;
      field.status = "confirmed";
      field.note = undefined;
      f.history.push({ at: new Date().toISOString(), by: user.name, text: `Confirmed ${labelOf(path)} against the page` });
    } else {
      if (field.original === undefined) field.original = field.value;
      const kind = FIELD_KINDS[path] ?? (/\.code$/.test(path) ? "icd" : undefined);
      const problem = value && kind ? formatProblem(value, kind) : null;
      field.value = value;
      field.status = value ? (problem ? "check" : "edited") : "missing";
      field.note = problem ?? undefined;
      f.history.push({ at: new Date().toISOString(), by: user.name, text: `Changed ${labelOf(path)} to "${value ?? "(empty)"}"` });
    }
    refresh(f, patients, others);
  });
  const { raw: _raw, ...out } = updated;
  void _raw;
  return NextResponse.json({ fax: out });
}
