import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { checkFaxBack } from "@/lib/faxback";
import { errorResponse, readJsonBody } from "@/lib/http";
import { updateFax } from "@/lib/store";

/** PUT /api/faxes/:id/fax-back (coordinator): {text} saves edits to the missing-items request. The app never sends it. */
export async function PUT(request: Request, ctx: RouteContext<"/api/faxes/[id]/fax-back">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  const text = String((await readJsonBody(request))?.text ?? "").trim();
  if (!text) return errorResponse({ title: "Empty", message: "The request cannot be empty." });
  if (text.length > 4000) return errorResponse({ title: "Too long", message: "Keep it under 4,000 characters." });
  const updated = await updateFax(access.fax.id, (f) => {
    f.faxBack = { text, source: "edited", issues: checkFaxBack(text) };
    f.history.push({ at: new Date().toISOString(), by: access.user.name, text: "Edited the request for missing items" });
  });
  return NextResponse.json({ faxBack: updated.faxBack });
}
