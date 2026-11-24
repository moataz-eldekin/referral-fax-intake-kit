import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { QUEUE_LABELS } from "@/lib/checks";
import { errorResponse, readJsonBody } from "@/lib/http";
import { updateFax } from "@/lib/store";
import { QUEUES, type Queue } from "@/lib/types";

/** POST /api/faxes/:id/queue (coordinator): {queue} moves the fax by hand. Booking is done with /book. */
export async function POST(request: Request, ctx: RouteContext<"/api/faxes/[id]/queue">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  const queue = String((await readJsonBody(request))?.queue ?? "") as Queue;
  if (!QUEUES.includes(queue) || queue === "booked") return errorResponse({ title: "Unknown queue", message: "Pick Needs review, Needs info, Ready to book or Not a referral." });
  if (access.fax.appointmentId) return errorResponse({ title: "Already booked", message: "Cancel the visit first." }, 409);
  const updated = await updateFax(access.fax.id, (f) => {
    f.queue = queue;
    f.history.push({ at: new Date().toISOString(), by: access.user.name, text: `Moved to ${QUEUE_LABELS[queue]}` });
  });
  const { raw: _raw, ...out } = updated;
  void _raw;
  return NextResponse.json({ fax: out });
}
