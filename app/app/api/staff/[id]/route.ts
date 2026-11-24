import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, parseStaffInput, readJsonBody } from "@/lib/http";
import { deleteStaff, updateStaff } from "@/lib/store";

export async function PUT(request: Request, ctx: RouteContext<"/api/staff/[id]">) {
  const user = await requireApiUser("admin");
  if (user instanceof NextResponse) return user;
  const { id } = await ctx.params;
  const parsed = parseStaffInput(await readJsonBody(request));
  if ("error" in parsed) return errorResponse({ title: "Check the form", message: parsed.error });
  const staff = await updateStaff(id, parsed.value);
  if (!staff) return errorResponse({ title: "Not found", message: "That account no longer exists." }, 404);
  if ("error" in staff) return errorResponse({ title: "Check the form", message: staff.error }, 409);
  return NextResponse.json({ staff });
}

/** DELETE removes the login. Faxes and their history are kept. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/staff/[id]">) {
  const user = await requireApiUser("admin");
  if (user instanceof NextResponse) return user;
  const { id } = await ctx.params;
  if (!(await deleteStaff(id))) return errorResponse({ title: "Not found", message: "That account no longer exists." }, 404);
  return new NextResponse(null, { status: 204 });
}
