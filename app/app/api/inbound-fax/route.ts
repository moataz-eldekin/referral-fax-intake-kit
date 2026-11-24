import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { faxWebhookSecret, MAX_UPLOAD_BYTES } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { createFax, runPipeline } from "@/lib/pipeline";

/**
 * POST /api/inbound-fax: where a fax service (Documo, SRFax, Sinch, eFax...) delivers new faxes.
 * Headers: X-Webhook-Secret = FAX_WEBHOOK_SECRET. Body: multipart {file (PDF or TIFF), from?}.
 * Off until FAX_WEBHOOK_SECRET is set. Most services need a small adapter to this shape.
 */
export async function POST(request: Request) {
  const secret = faxWebhookSecret();
  if (!secret) return errorResponse({ title: "Inbound fax is off", message: "Set FAX_WEBHOOK_SECRET to turn on this endpoint." }, 503);
  const given = Buffer.from(request.headers.get("x-webhook-secret") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return errorResponse({ title: "Not allowed", message: "The webhook secret is missing or wrong." }, 401);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 100_000) {
    return errorResponse({ title: "File too large", message: "Faxes can be at most 10 MB." }, 413);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse({ title: "Bad request", message: "Send multipart form data with a file field." });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse({ title: "No file", message: "The file field is missing." });
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse({ title: "File too large", message: "Faxes can be at most 10 MB." }, 413);
  try {
    const fax = await createFax({
      files: [Buffer.from(await file.arrayBuffer())],
      fileName: file.name || "inbound-fax.pdf",
      source: "fax_service",
      fromFax: String(form.get("from") ?? "").trim() || undefined,
      by: "Fax service",
    });
    after(() => runPipeline(fax.id));
    return NextResponse.json({ id: fax.id, pages: fax.pageCount }, { status: 202 });
  } catch (err) {
    return errorResponse({ title: "Could not read the fax", message: err instanceof Error ? err.message : String(err) });
  }
}
