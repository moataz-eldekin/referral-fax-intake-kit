/** Small helpers shared by the route handlers. */
import { NextResponse } from "next/server";
import type { StaffInput } from "./store";
import type { AppError } from "./types";

export function errorResponse(error: AppError, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validates coordinator fields from the admin form. */
export function parseStaffInput(body: Record<string, unknown> | null): { value: StaffInput } | { error: string } {
  if (!body) return { error: "Send the account as JSON." };
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!name) return { error: "Name is required." };
  if (name.length > 120) return { error: "Name must be 120 characters or fewer." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  return { value: { name, email } };
}

/** Passwords: at least 8 characters. */
export function parsePassword(raw: unknown): string | { error: string } {
  const password = String(raw ?? "");
  if (password.length < 8) return { error: "Passwords need at least 8 characters." };
  if (password.length > 200) return { error: "Passwords can be at most 200 characters." };
  return password;
}
