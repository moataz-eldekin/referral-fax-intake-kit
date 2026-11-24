/**
 * Who is logged in, and what they may do.
 *   admin:       manages coordinator accounts, sees every fax (read-only)
 *   coordinator: uploads faxes, reviews referrals, books visits. The queue is shared.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "./session";
import { getFax, getUser } from "./store";
import type { Fax, Role, User } from "./types";

export async function getCurrentUser(): Promise<User | null> {
  const id = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return id ? ((await getUser(id)) ?? null) : null;
}

/** For pages: redirect to /login (or home) unless the user has the role. */
export async function requirePageUser(role?: Role): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect("/");
  return user;
}

/** For API routes: returns the user, or a 401/403 response to send back. */
export async function requireApiUser(role?: Role): Promise<User | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { title: "Please log in", message: "Your session has ended. Log in again." } }, { status: 401 });
  }
  if (role && user.role !== role) {
    return NextResponse.json(
      { error: { title: "Not allowed", message: role === "admin" ? "Only the admin can do this." : "Only intake coordinators can do this. The admin view is read-only." } },
      { status: 403 },
    );
  }
  return user;
}

/** Loads a fax for an API route. With `write`, only a coordinator may continue (the admin is read-only). */
export async function requireFaxAccess(id: string, write = false): Promise<{ user: User; fax: Fax } | NextResponse> {
  const user = await requireApiUser(write ? "coordinator" : undefined);
  if (user instanceof NextResponse) return user;
  const fax = await getFax(id);
  if (!fax) return NextResponse.json({ error: { title: "Not found", message: "That fax does not exist." } }, { status: 404 });
  return { user, fax };
}
