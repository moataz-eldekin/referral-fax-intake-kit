import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, parsePassword, readJsonBody } from "@/lib/http";
import { getUser, setPassword } from "@/lib/store";

/** POST /api/staff/:id/password {password}: the admin resets a coordinator's password. */
export async function POST(request: Request, ctx: RouteContext<"/api/staff/[id]/password">) {
  const user = await requireApiUser("admin");
  if (user instanceof NextResponse) return user;
  const { id } = await ctx.params;
  const target = await getUser(id);
  if (!target || target.role !== "coordinator") return errorResponse({ title: "Not found", message: "That account no longer exists." }, 404);
  const password = parsePassword((await readJsonBody(request))?.password);
  if (typeof password !== "string") return errorResponse({ title: "Check the password", message: password.error });
  await setPassword(id, password);
  return new NextResponse(null, { status: 204 });
}
