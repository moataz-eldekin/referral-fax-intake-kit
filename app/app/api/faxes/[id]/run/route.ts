import { after, NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { claimRun, runPipeline } from "@/lib/pipeline";

/** POST /api/faxes/:id/run (coordinator): run the intake again. Only pays for what changed. 409 if it is already running. */
export async function POST(_request: Request, ctx: RouteContext<"/api/faxes/[id]/run">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  if (access.fax.appointmentId) return errorResponse({ title: "Already booked", message: "Cancel the visit before running the intake again." }, 409);
  if (!(await claimRun(access.fax.id, access.user.name))) {
    return errorResponse({ title: "Already running", message: "This fax is being processed. Wait for it to finish." }, 409);
  }
  after(() => runPipeline(access.fax.id));
  return NextResponse.json({ ok: true }, { status: 202 });
}
