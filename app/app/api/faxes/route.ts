import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { errorResponse, readJsonBody } from "@/lib/http";
import { createFax, runPipeline } from "@/lib/pipeline";
import { loadSampleFile } from "@/lib/samples";
import { listFaxes, summarize } from "@/lib/store";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ faxes: (await listFaxes()).map(summarize) });
}

/**
 * POST /api/faxes (coordinator): multipart {file (one PDF or TIFF, or several PNG/JPG pages), fromFax?}
 * or JSON {sample: "<slug>"}. Answers at once; OCR and the Sully steps run after the response.
 */
export async function POST(request: Request) {
  const user = await requireApiUser("coordinator");
  if (user instanceof NextResponse) return user;
  const type = request.headers.get("content-type") ?? "";
  let files: Buffer[] = [];
  let fileName = "fax";
  let fromFax: string | undefined;
  let sample: string | undefined;

  if (type.includes("application/json")) {
    const body = await readJsonBody(request);
    const loaded = await loadSampleFile(String(body?.sample ?? ""));
    if (!loaded) return errorResponse({ title: "Sample not found", message: "Pick one of the sample faxes." }, 404);
    files = [loaded.pdf];
    fileName = `${loaded.manifest.title}.pdf`;
    fromFax = loaded.fromFax;
    sample = loaded.manifest.slug;
  } else if (type.includes("multipart/form-data")) {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES + 100_000) return errorResponse({ title: "File too large", message: "Faxes can be at most 10 MB." }, 413);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse({ title: "Upload failed", message: "The upload could not be read. Try again." });
    }
    const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!uploads.length) return errorResponse({ title: "No file", message: "Choose a fax file to upload." });
    if (uploads.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES) return errorResponse({ title: "File too large", message: "Faxes can be at most 10 MB." }, 413);
    files = await Promise.all(uploads.map(async (f) => Buffer.from(await f.arrayBuffer())));
    fileName = uploads[0].name || "fax";
    fromFax = String(form.get("fromFax") ?? "").trim() || undefined;
  } else {
    return errorResponse({ title: "Unsupported request", message: "Send a multipart upload or a sample name." }, 415);
  }

  let fax;
  try {
    fax = await createFax({ files, fileName, source: sample ? "sample" : "upload", fromFax, sample, by: user.name });
  } catch (err) {
    return errorResponse({ title: "Could not read the fax", message: err instanceof Error ? err.message : String(err) });
  }
  after(() => runPipeline(fax.id));
  return NextResponse.json({ fax: summarize(fax) }, { status: 201 });
}
