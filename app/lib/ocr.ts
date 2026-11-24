/**
 * Step 1 of the pipeline: turn the fax into page images and read every page.
 *
 * Sully M1 does not read images, so each page is read here with tesseract.js
 * (local OCR, nothing leaves the server). PDFs are rendered at 200 dpi, TIFFs
 * (what most fax services send) are split into pages, PNG/JPG are used as they are.
 * Every page is converted to grayscale and nothing else, so the content is unchanged.
 */
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import { MAX_PAGES, RENDER_DPI, TESSDATA_DIR } from "./config";
import type { Box, FaxPage, OcrWord } from "./types";

export type UploadKind = "pdf" | "tiff" | "image";

/** Works out the file type from its first bytes, never from the name alone. */
export function sniff(buf: Buffer): UploadKind | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const tiff = buf.subarray(0, 4).toString("hex");
  if (tiff === "49492a00" || tiff === "4d4d002a") return "tiff";
  if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image"; // PNG
  if (buf.subarray(0, 3).toString("hex") === "ffd8ff") return "image"; // JPEG
  return null;
}

/** Splits one upload into grayscale PNG pages. Throws a plain message on bad input. */
export async function toPageImages(files: Buffer[]): Promise<Buffer[]> {
  const pages: Buffer[] = [];
  for (const buf of files) {
    const kind = sniff(buf);
    if (!kind) throw new Error("This file type is not supported. Upload a PDF, TIFF, PNG or JPG.");
    if (kind === "pdf") {
      const { pdf } = await import("pdf-to-img");
      const doc = await pdf(buf, { scale: RENDER_DPI / 72 });
      if (pages.length + doc.length > MAX_PAGES) throw new Error(`A fax can have at most ${MAX_PAGES} pages.`);
      for await (const png of doc) pages.push(await gray(png));
    } else if (kind === "tiff") {
      const meta = await sharp(buf).metadata();
      const count = meta.pages ?? 1;
      if (pages.length + count > MAX_PAGES) throw new Error(`A fax can have at most ${MAX_PAGES} pages.`);
      for (let i = 0; i < count; i++) pages.push(await gray(await sharp(buf, { page: i }).png().toBuffer()));
    } else {
      if (pages.length + 1 > MAX_PAGES) throw new Error(`A fax can have at most ${MAX_PAGES} pages.`);
      pages.push(await gray(buf));
    }
  }
  if (!pages.length) throw new Error("The file has no pages.");
  return pages;
}

async function gray(buf: Buffer): Promise<Buffer> {
  return sharp(buf).flatten({ background: "#ffffff" }).grayscale().png().toBuffer();
}

// One OCR worker per server process; starting one takes about a second.
const holder = globalThis as unknown as { __ocr?: Promise<Worker> };
function worker(): Promise<Worker> {
  holder.__ocr ??= createWorker("eng", 1, { langPath: TESSDATA_DIR, gzip: true, cachePath: TESSDATA_DIR }).catch((err) => {
    holder.__ocr = undefined;
    throw err;
  });
  return holder.__ocr;
}

// tesseract.js runs one page at a time per worker; queue callers so pages never mix.
const queue = globalThis as unknown as { __ocrQueue?: Promise<unknown> };
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const prev = queue.__ocrQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queue.__ocrQueue = next.catch(() => undefined);
  return next;
}

type TLine = { text: string; confidence: number; words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> };

/** Reads one page. Returns its text (one line per OCR line), word boxes and mean confidence. */
export async function readPage(n: number, png: Buffer): Promise<FaxPage> {
  const meta = await sharp(png).metadata();
  const w = await worker();
  const { data } = await serial(() => w.recognize(png, {}, { text: true, blocks: true }));
  const lines: TLine[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines as unknown as TLine[]));
  const words: OcrWord[] = [];
  const textLines: string[] = [];
  for (const line of lines) {
    const t = line.text.replace(/\s+$/, "");
    if (!t.trim()) continue;
    textLines.push(t);
    for (const wd of line.words) {
      if (!wd.text.trim()) continue;
      const box: Box = [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1];
      words.push({ text: wd.text, conf: Math.round(wd.confidence), box });
    }
  }
  return {
    n,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    text: textLines.join("\n"),
    words,
    confidence: Math.round(data.confidence),
  };
}
