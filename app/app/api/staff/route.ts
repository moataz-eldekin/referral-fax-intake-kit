import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, parsePassword, parseStaffInput, readJsonBody } from "@/lib/http";
import { createStaff, listStaff } from "@/lib/store";

export async function GET() {
  const user = await requireApiUser("admin");
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ staff: await listStaff() });
}

/** POST /api/staff: create a coordinator account (admin only). */
export async function POST(request: Request) {
  const user = await requireApiUser("admin");
  if (user instanceof NextResponse) return user;
  const body = await readJsonBody(request);
  const parsed = parseStaffInput(body);
  if ("error" in parsed) return errorResponse({ title: "Check the form", message: parsed.error });
  const password = parsePassword(body?.password);
  if (typeof password !== "string") return errorResponse({ title: "Check the form", message: password.error });
  const staff = await createStaff(parsed.value, password);
  if ("error" in staff) return errorResponse({ title: "Check the form", message: staff.error }, 409);
  return NextResponse.json({ staff }, { status: 201 });
}
