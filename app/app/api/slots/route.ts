import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { bookBy, openSlots } from "@/lib/slots";
import { listAppointments } from "@/lib/store";

/** GET /api/slots?specialty=Cardiology: open new-patient slots for the next weeks, and the urgent book-by date. */
export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const specialty = new URL(request.url).searchParams.get("specialty") ?? "";
  return NextResponse.json({ slots: openSlots(specialty, await listAppointments()), bookBy: bookBy(specialty) });
}
