/**
 * The whole intake pipeline for one fax:
 *   1. Receive: split the upload into page images (lib/ocr.ts), then OCR each page
 *   2. Sort: Sully M1 says what kind of fax it is and what each page is (lib/classify.ts)
 *   3. Extract: Sully Text to JSON pulls out patient, referring provider, reason, insurance (lib/extract.ts)
 *   4. Match: compare with existing patients and recent referrals (lib/checks.ts)
 *   5. Flag: required items, attachments, page count, formats, urgency (lib/checks.ts),
 *      and Sully M1 drafts the request for what is missing (lib/faxback.ts)
 *   6. Route: put it in the right queue (lib/checks.ts). Booking is done by a coordinator.
 *
 * Never runs twice at once for the same fax, and never retries a billable request.
 */
import { createHash, randomUUID } from "node:crypto";
import { buildReferral, computeChecks, computeUrgency, findDuplicate, matchPatient, routeQueue } from "./checks";
import { classifyFax, classifyInput, classifyRequest, validateClassification } from "./classify";
import { isDemoMode } from "./config";
import { toAppError } from "./errors";
import { cleanReferral, extractInput, extractReferral, REFERRAL_SCHEMA } from "./extract";
import { draftFaxBack, faxBackRequest, missingItems, templateFaxBack } from "./faxback";
import { readPage, toPageImages } from "./ocr";
import { demoResults } from "./samples";
import { demoCall, M1_PATH, SullyError, TEXT_TO_JSON_PATH } from "./sully";
import { getFax, listFaxes, listPatients, readPageImage, saveFax, savePageImage, updateFax } from "./store";
import type { Fax, FaxPage } from "./types";

const STALE_MS = 5 * 60_000;

export function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Step 1a: save the upload as page images and create the fax record. Throws a plain message on bad files. */
export async function createFax(input: { files: Buffer[]; fileName: string; source: Fax["source"]; fromFax?: string; sample?: string; by: string }): Promise<Fax> {
  const images = await toPageImages(input.files);
  const id = randomUUID();
  for (const [i, png] of images.entries()) await savePageImage(id, i + 1, png);
  const now = new Date().toISOString();
  const fax: Fax = {
    id,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    fileName: input.fileName.slice(0, 160),
    fromFax: input.fromFax?.slice(0, 40) || undefined,
    sample: input.sample,
    pageCount: images.length,
    pages: images.map((_, i) => ({ n: i + 1, width: 0, height: 0, text: "", words: [], confidence: 0 })),
    checks: [],
    urgency: { level: "routine", reasons: [] },
    queue: "review",
    run: { status: "running", startedAt: now, progress: `Reading page 1 of ${images.length}` },
    history: [{ at: now, by: input.by, text: input.source === "fax_service" ? `Received from the fax service${input.fromFax ? ` (from ${input.fromFax})` : ""}` : `Uploaded ${input.fileName}` }],
    calls: [],
  };
  await saveFax(fax);
  return fax;
}

/** Marks the fax as running. Returns false if a run is already in progress. */
export async function claimRun(id: string, by: string): Promise<boolean> {
  let claimed = false;
  await updateFax(id, (f) => {
    const running = f.run.status === "running" && f.run.startedAt && Date.now() - new Date(f.run.startedAt).getTime() < STALE_MS;
    if (running) return;
    f.run = { status: "running", startedAt: new Date().toISOString(), progress: "Starting" };
    f.history.push({ at: new Date().toISOString(), by, text: "Ran the intake again" });
    claimed = true;
  });
  return claimed;
}

export async function runPipeline(id: string): Promise<Fax | undefined> {
  const start = await getFax(id);
  if (!start) return undefined;
  const demo = isDemoMode();
  const recorded = demo && start.sample ? await demoResults(start.sample) : undefined;

  try {
    // 1. OCR every page that has no text yet (cached per page).
    for (const p of start.pages) {
      if (p.text) continue;
      await updateFax(id, (f) => void (f.run.progress = `Reading page ${p.n} of ${start.pageCount}`));
      const png = await readPageImage(id, p.n);
      if (!png) throw new Error(`Page ${p.n} image is missing.`);
      const page = await readPage(p.n, png);
      await updateFax(id, (f) => void (f.pages[p.n - 1] = { ...page, type: f.pages[p.n - 1]?.type }));
    }
    let fax = (await getFax(id))!;
    const pages: FaxPage[] = fax.pages;

    // 2. Sort the fax and its pages (Sully M1).
    if (demo && !recorded) {
      return await updateFax(id, (f) => {
        f.run = { ...f.run, status: "error", finishedAt: new Date().toISOString(), progress: undefined, error: { title: "Demo mode: pages read, nothing sent to Sully", message: "The pages were read with OCR. Add your Sully keys in .env.local to sort the fax and pull out the referral. Sample faxes run end to end in demo mode." } };
      });
    }
    await updateFax(id, (f) => void (f.run.progress = "Sorting the pages"));
    const classifyKey = hash(classifyInput(pages));
    let classRaw = fax.cache?.classify === classifyKey ? fax.raw?.classify : undefined;
    if (!classRaw) {
      if (recorded) {
        classRaw = recorded.classify;
        await pushCall(id, demoCall("Sort the fax pages", classifyRequest(pages), recorded.classify, M1_PATH));
      } else {
        const out = await classifyFax(pages);
        classRaw = out.raw;
        await pushCall(id, out.call);
      }
    }
    const sorted = validateClassification(classRaw, pages);
    fax = await updateFax(id, (f) => {
      f.kind = sorted.kind;
      f.kindRationale = sorted.rationale;
      f.pages = f.pages.map((p) => {
        const s = sorted.pages.find((x) => x.n === p.n);
        return s ? { ...p, type: s.type, typeEvidence: s.evidence, typeUnsure: s.unsure } : p;
      });
      f.cache = { ...f.cache, classify: classifyKey };
      f.raw = { ...f.raw, classify: classRaw };
    });

    // 3. Extract the referral (Sully Text to JSON). Only for referrals.
    if (sorted.kind === "referral") {
      await updateFax(id, (f) => void (f.run.progress = "Pulling out the referral details"));
      const extractKey = hash(extractInput(fax.pages) + JSON.stringify(REFERRAL_SCHEMA));
      let extRaw = fax.cache?.extract === extractKey ? fax.raw?.extract : undefined;
      if (!extRaw) {
        if (recorded) {
          extRaw = recorded.extract;
          await pushCall(id, demoCall("Extract the referral", { text: extractInput(fax.pages), schema: REFERRAL_SCHEMA }, { data: recorded.extract }, TEXT_TO_JSON_PATH));
        } else {
          const out = await extractReferral(fax.pages);
          extRaw = out.raw;
          await pushCall(id, out.call);
        }
      }
      const referral = buildReferral(cleanReferral(extRaw), fax.pages);
      fax = await updateFax(id, (f) => {
        f.referral = referral;
        f.cache = { ...f.cache, extract: extractKey };
        f.raw = { ...f.raw, extract: extRaw };
      });
    } else {
      fax = await updateFax(id, (f) => void (f.referral = undefined));
    }

    // 4 and 5. Match, flag, route.
    await updateFax(id, (f) => void (f.run.progress = "Checking"));
    const [patients, others] = await Promise.all([listPatients(), listFaxes()]);
    fax = await updateFax(id, (f) => {
      const r = f.referral;
      f.urgency = computeUrgency(r, f.pages).urgency;
      f.match = r && f.match?.status !== "confirmed" && f.match?.status !== "created" ? matchPatient(r.patient.name.value, r.patient.dob.value, patients) : f.match;
      f.duplicateOf = r ? findDuplicate(f, others)?.id : undefined;
      f.checks = computeChecks(f);
      f.queue = routeQueue(f);
    });

    // 5b. Draft the request for missing items (Sully M1).
    if (fax.referral && fax.checks.some((c) => c.level === "missing") && fax.faxBack?.source !== "edited") {
      const items = missingItems(fax.checks);
      const key = hash(JSON.stringify(items) + (fax.referral.patient.name.value ?? ""));
      if (fax.cache?.faxBack !== key) {
        await updateFax(id, (f) => void (f.run.progress = "Drafting the request for missing items"));
        if (recorded?.faxBack) {
          const text = recorded.faxBack;
          await pushCall(id, demoCall("Draft the request for missing items", faxBackRequest(fax.referral, items), { choices: [{ message: { content: text } }] }, M1_PATH));
          await updateFax(id, (f) => {
            f.faxBack = { text, source: "m1" };
            f.cache = { ...f.cache, faxBack: key };
          });
        } else if (recorded) {
          await updateFax(id, (f) => void (f.faxBack = { text: templateFaxBack(fax.referral!, items), source: "template" }));
        } else {
          const out = await draftFaxBack(fax.referral, fax.checks);
          for (const c of out.calls) await pushCall(id, c);
          await updateFax(id, (f) => {
            f.faxBack = out.faxBack;
            f.cache = { ...f.cache, faxBack: key };
          });
        }
      }
    }

    return await updateFax(id, (f) => {
      f.run = { status: "done", startedAt: f.run.startedAt, finishedAt: new Date().toISOString() };
    });
  } catch (err) {
    // A failed step never leaves a referral looking routine: urgent until a person reviews it.
    return await updateFax(id, (f) => {
      if (err instanceof SullyError) f.calls.push(err.call);
      f.run = { ...f.run, status: "error", finishedAt: new Date().toISOString(), progress: undefined, error: toAppError(err) };
      f.urgency = { level: "urgent", reasons: [...f.urgency.reasons.filter((r) => !r.startsWith("The intake did not finish")), "The intake did not finish, so this fax is treated as urgent until a person reviews it."] };
      f.queue = f.kind && f.kind !== "referral" ? "other" : "review";
    });
  }
}

async function pushCall(id: string, call: Fax["calls"][number]): Promise<void> {
  await updateFax(id, (f) => void f.calls.push(call));
}
