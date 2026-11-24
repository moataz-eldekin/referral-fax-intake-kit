/**
 * Sample faxes in ./test-data (synthetic, fictional patients). Each folder has:
 *   fax.pdf            the fax as a fax service would deliver it
 *   expected.json      ground truth for the eval (title, blurb, fields, flags)
 *   demo-results.json  recorded Sully results, replayed in demo mode (written by scripts/eval.py --record-demo)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { TEST_DATA_DIR } from "./config";

export type SampleManifest = { slug: string; title: string; blurb: string; order: number };
export type DemoResults = { classify: unknown; extract?: unknown; faxBack?: string };

const SLUG = /^[a-z0-9-]+$/;
const FAXES = path.join(TEST_DATA_DIR, "faxes");

export async function listSamples(): Promise<SampleManifest[]> {
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(FAXES);
  } catch {
    return [];
  }
  const out: SampleManifest[] = [];
  for (const slug of dirs.filter((d) => SLUG.test(d))) {
    try {
      const e = JSON.parse(await fs.readFile(path.join(FAXES, slug, "expected.json"), "utf8"));
      out.push({ slug, title: e.title, blurb: e.blurb, order: e.order ?? 99 });
    } catch {
      // not a sample folder
    }
  }
  return out.sort((a, b) => a.order - b.order);
}

export async function loadSampleFile(slug: string): Promise<{ pdf: Buffer; manifest: SampleManifest; fromFax?: string } | undefined> {
  if (!SLUG.test(slug)) return undefined;
  try {
    const dir = path.join(FAXES, slug);
    const e = JSON.parse(await fs.readFile(path.join(dir, "expected.json"), "utf8"));
    return { pdf: await fs.readFile(path.join(dir, "fax.pdf")), manifest: { slug, title: e.title, blurb: e.blurb, order: e.order ?? 99 }, fromFax: e.fromFax };
  } catch {
    return undefined;
  }
}

export async function demoResults(slug: string): Promise<DemoResults | undefined> {
  if (!SLUG.test(slug)) return undefined;
  try {
    return JSON.parse(await fs.readFile(path.join(FAXES, slug, "demo-results.json"), "utf8")) as DemoResults;
  } catch {
    return undefined;
  }
}
