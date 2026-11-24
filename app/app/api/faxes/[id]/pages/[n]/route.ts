import { NextResponse } from "next/server";
import { requireFaxAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { readPageImage } from "@/lib/store";

/** GET /api/faxes/:id/pages/:n: the page image (logged-in staff only, never cached by browsers or proxies). */
export async function GET(_request: Request, ctx: RouteContext<"/api/faxes/[id]/pages/[n]">) {
  const { id, n } = await ctx.params;
  const access = await requireFaxAccess(id);
  if (access instanceof NextResponse) return access;
  const page = Number(n);
  if (!Number.isInteger(page) || page < 1 || page > access.fax.pageCount) return errorResponse({ title: "Not found", message: "That page does not exist." }, 404);
  const png = await readPageImage(id, page);
  if (!png) return errorResponse({ title: "Not found", message: "That page image is missing." }, 404);
  return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
