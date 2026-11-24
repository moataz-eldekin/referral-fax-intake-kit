import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { deleteFax, removeAppointment } from "@/lib/store";

/** GET /api/faxes/:id: the fax (polled while the intake runs). */
export async function GET(_request: Request, ctx: RouteContext<"/api/faxes/[id]">) {
  const access = await requireFaxAccess((await ctx.params).id);
  if (access instanceof NextResponse) return access;
  const { raw: _raw, ...fax } = access.fax;
  void _raw;
  return NextResponse.json({ fax });
}

/** DELETE (coordinator): removes the fax, its pages and any visit booked from it. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/faxes/[id]">) {
  const access = await requireFaxAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  if (access.fax.appointmentId) await removeAppointment(access.fax.appointmentId);
  await deleteFax(access.fax.id);
  return new NextResponse(null, { status: 204 });
}
