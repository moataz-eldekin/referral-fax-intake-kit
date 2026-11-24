/**
 * Steps 4 to 6 in plain code (no model): check every field against the page,
 * match the patient, find what is missing, and pick the queue.
 *
 * - A field is "found" only when its quote is on the fax and its value is in
 *   that quote. Otherwise it is "check" (a person looks) or "missing".
 * - Formats are checked: NPI check digit, ICD-10 shape, real date of birth, 10-digit phones.
 * - Required items come from config/intake.json, per specialty.
 * - The urgency net can raise a referral to urgent, never lower it.
 */
import { DUPLICATE_DAYS, INTAKE, LOW_CONFIDENCE, specialtyConfig } from "./config";
import type { Cell, RawReferral } from "./extract";
import { findOnPages, valueInQuote } from "./quote";
import type { Check, Fax, FaxPage, Field, PageType, Patient, PatientMatch, Queue, Referral, Urgency } from "./types";

// ---------- Fields ----------

type FieldKind = "text" | "id" | "npi" | "dob" | "phone" | "icd";

function toField(cell: Cell, pages: FaxPage[], kind: FieldKind = "text"): Field {
  if (!cell.value) return { value: null, quote: null, page: null, status: "missing" };
  const hit = findOnPages(pages, cell.quote, cell.page);
  if (!hit) {
    return { ...cell, status: "check", note: cell.quote ? "These words were not found on the fax. Check the page." : "No source words were given. Check the page." };
  }
  const field: Field = { ...cell, page: hit.page, boxes: hit.boxes, status: "found" };
  const page = pages.find((p) => p.n === hit.page);
  const conf = page ? meanConfidence(page, hit.boxes) : 100;
  // One- or two-letter values (sex "M") always score low in OCR; their quote check is enough.
  if (conf < LOW_CONFIDENCE && cell.value.length > 2) return { ...field, status: "check", note: "The words are faint or hard to read on the fax." };
  if (kind !== "text" && kind !== "dob" && !valueInQuote(cell.value, cell.quote ?? "")) {
    return { ...field, status: "check", note: `The fax reads "${cell.quote}". Check the value against the page.` };
  }
  const problem = formatProblem(cell.value, kind);
  return problem ? { ...field, status: "check", note: problem } : field;
}

function meanConfidence(page: FaxPage, boxes: Field["boxes"]): number {
  const keys = new Set((boxes ?? []).map((b) => b.join(",")));
  const confs = page.words.filter((w) => keys.has(w.box.join(","))).map((w) => w.conf);
  return confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 100;
}

export function formatProblem(value: string, kind: FieldKind): string | null {
  if (kind === "npi") return /^\d{10}$/.test(value) ? (npiValid(value) ? null : "This NPI fails the check digit test. It is probably misread or mistyped.") : "An NPI has 10 digits.";
  if (kind === "icd") return /^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(value) ? null : "This does not look like an ICD-10 code.";
  if (kind === "phone") return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length === 10 ? null : "A US phone number has 10 digits.";
  if (kind === "dob") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "The date of birth could not be read as a date.";
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return "This is not a real date.";
    if (d > new Date()) return "This date of birth is in the future.";
    if (new Date().getUTCFullYear() - +m[1] > 120) return "This date of birth makes the patient older than 120.";
  }
  return null;
}

/** NPI check digit: Luhn over "80840" + the first 9 digits. */
export function npiValid(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`.split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

export function buildReferral(raw: RawReferral, pages: FaxPage[]): Referral {
  return {
    patient: {
      name: toField(raw.patient.name, pages),
      dob: toField(raw.patient.dob, pages, "dob"),
      sex: toField(raw.patient.sex, pages),
      phone: toField(raw.patient.phone, pages, "phone"),
      address: toField(raw.patient.address, pages),
    },
    insurance: {
      payer: toField(raw.insurance.payer, pages),
      member_id: toField(raw.insurance.member_id, pages, "id"),
      group_number: toField(raw.insurance.group_number, pages, "id"),
    },
    referring: {
      name: toField(raw.referring.name, pages),
      npi: toField(raw.referring.npi, pages, "npi"),
      practice: toField(raw.referring.practice, pages),
      phone: toField(raw.referring.phone, pages, "phone"),
      fax: toField(raw.referring.fax, pages, "phone"),
    },
    specialty: toField(raw.specialty, pages),
    urgency: toField(raw.urgency, pages),
    reason: toField(raw.reason, pages),
    diagnoses: raw.diagnoses.map((d) => ({ code: toField(d.code, pages, "icd"), description: toField(d.description, pages) })),
    records_said_attached: raw.records_said_attached.filter((item) => boxState(pages, item) !== "empty"),
    pages_stated: raw.pages_stated,
    handwritten_notes: raw.handwritten_notes,
  };
}

// ---------- Checkboxes ----------

// OCR reads a ticked box as "[X", "[XI", "X]", "[x]" or "☒", and an empty one as "[ ]", "[]", "[J", "[1", "[l", "[I" or a lone "[".
const TICKED_BEFORE = /(\[\s*[xX×]\s*[\]Il1|]?|[xX×]\]|☒|☑|■)\s*$/;
const EMPTY_BEFORE = /(\[\s*\]|\[\s*[JjIl1|]?\s*\]?|☐|□)\s*$/;

/**
 * Reads a checkbox from the OCR text: the mark right before the label. Plain code,
 * because Text to JSON cannot reliably tell "[J" (empty) from "[X" (ticked).
 */
export function boxState(pages: FaxPage[], label: string): "ticked" | "empty" | "unknown" {
  const words = label.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return "unknown";
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"), "i");
  for (const p of pages) {
    for (const line of p.text.split("\n")) {
      const m = pattern.exec(line);
      if (!m) continue;
      const before = line.slice(Math.max(0, m.index - 4), m.index);
      if (TICKED_BEFORE.test(before)) return "ticked";
      if (EMPTY_BEFORE.test(before)) return "empty";
    }
  }
  return "unknown";
}

/** Field paths the UI and the edit route use. */
export const FIELD_PATHS = [
  "patient.name", "patient.dob", "patient.sex", "patient.phone", "patient.address",
  "insurance.payer", "insurance.member_id", "insurance.group_number",
  "referring.name", "referring.npi", "referring.practice", "referring.phone", "referring.fax",
  "specialty", "urgency", "reason",
] as const;
export type FieldPath = (typeof FIELD_PATHS)[number] | `diagnoses.${number}.code` | `diagnoses.${number}.description`;

export function getField(r: Referral, path: string): Field | undefined {
  const parts = path.split(".");
  let cur: unknown = r;
  for (const p of parts) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
  return cur && typeof cur === "object" && "status" in (cur as object) ? (cur as Field) : undefined;
}

export const FIELD_KINDS: Record<string, FieldKind> = {
  "patient.dob": "dob", "patient.phone": "phone", "insurance.member_id": "id", "insurance.group_number": "id",
  "referring.npi": "npi", "referring.phone": "phone", "referring.fax": "phone",
};

// ---------- Urgency ----------

const URGENT_WORDS: Array<{ label: string; pattern: RegExp }> = [
  { label: "urgent", pattern: /\b(urgent|urgently|stat|asap|a\.s\.a\.p|emergent)\b/i },
  { label: "a short deadline", pattern: /\b(this week|within (24|48|72) ?(hours|hrs)|within [1-7] days|next (1|2|3|few) days|same[- ]day|today if possible)\b/i },
  { label: "chest pain", pattern: /\b(chest (pain|pressure|tightness)|angina at rest|pain at rest)\b/i },
  { label: "fainting", pattern: /\b(syncope|syncopal|passed out|fainted|loss of consciousness)\b/i },
  { label: "stroke signs", pattern: /\b(stroke|tia|transient ischemic|facial droop|slurred speech|new weakness)\b/i },
  { label: "seizures", pattern: /\b(new[- ]onset seizures?|new seizures?|seizures? x ?\d)\b/i },
  { label: "suicide risk", pattern: /\b(suicid\w*|self[- ]harm)\b/i },
];
// Words just before a match that mean "no" (e.g. "no chest pain", "denies syncope").
const NEGATION = /\b(no|not|denies|denied|without|negative for|never|nor|ruled out|r\/o)( +[\w/'-]+){0,2} *$/i;

export function urgencyNet(pages: FaxPage[]): Array<{ label: string; quote: string; page: number }> {
  const hits: Array<{ label: string; quote: string; page: number }> = [];
  for (const w of URGENT_WORDS) {
    for (const p of pages) {
      const re = new RegExp(w.pattern.source, "gi");
      let found = false;
      for (const m of p.text.matchAll(re)) {
        const before = p.text.slice(Math.max(0, (m.index ?? 0) - 40), m.index).split("\n").pop() ?? "";
        if (NEGATION.test(before)) continue;
        const line = p.text.slice(p.text.lastIndexOf("\n", m.index) + 1).split("\n")[0].trim();
        hits.push({ label: w.label, quote: line.slice(0, 120), page: p.n });
        found = true;
        break;
      }
      if (found) break;
    }
  }
  return hits;
}

/** Lines the net skips: the fax header, and the form's urgency choices ("[ ] Routine [X] Urgent"), which only the ticked box decides. */
function netText(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/\bfrom:.*\bto:|\bP\.\s?\d+\/\d+/i.test(l) && !(/routine/i.test(l) && /urgent|stat/i.test(l)))
    .join("\n");
}

export function computeUrgency(referral: Referral | undefined, pages: FaxPage[]): { urgency: Urgency; conflict: string | null } {
  const reasons: string[] = [];
  const marked = referral?.urgency.value;
  // A coordinator's decision stands. The net only raises what the model read, never a person's call.
  if (referral && (referral.urgency.status === "edited" || referral.urgency.status === "confirmed")) {
    const level: Urgency["level"] = marked === "urgent" || marked === "stat" ? "urgent" : "routine";
    return { urgency: { level, reasons: [`Set to ${marked ?? "routine"} by a coordinator.`] }, conflict: null };
  }
  if (marked === "urgent" || marked === "stat") reasons.push(`Marked ${marked} on the referral${referral?.urgency.page ? ` (page ${referral.urgency.page})` : ""}.`);
  const net = urgencyNet(pages.map((p) => ({ ...p, text: netText(p.text) })));
  for (const h of net) reasons.push(`Page ${h.page} mentions ${h.label}: "${h.quote}"`);
  const level: Urgency["level"] = reasons.length ? "urgent" : "routine";
  // The form's own box says routine, but something else on the fax says urgent: a person decides.
  const routineTicked = marked === "routine" || (referral ? boxState(pages, "Routine") === "ticked" : false);
  const why = net[0] ? `page ${net[0].page} mentions ${net[0].label}` : "the referral is marked urgent elsewhere";
  const conflict = level === "urgent" && routineTicked ? `The Routine box is ticked, but ${why}. Treated as urgent until you decide.` : null;
  return { urgency: { level, reasons }, conflict };
}

// ---------- Patient match and duplicates ----------

export function nameTokens(name: string): string[] {
  const n = name.includes(",") ? name.split(",").reverse().join(" ") : name;
  return n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii"].includes(t));
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** First + last name compare, ignoring order and middle names. */
function nameScore(a: string, b: string): "same" | "close" | "different" {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return "different";
  const firstLast = (t: string[]) => [t[0], t[t.length - 1]].sort().join(" ");
  if (firstLast(x) === firstLast(y)) return "same";
  if (distance(firstLast(x), firstLast(y)) <= 2) return "close";
  return "different";
}

function dobSwapped(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
  return diff.length === 2 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

export function matchPatient(name: string | null, dob: string | null, patients: Patient[]): PatientMatch {
  if (!name || !dob) return { status: "new", candidates: [] };
  const candidates: PatientMatch["candidates"] = [];
  for (const p of patients) {
    const score = nameScore(name, p.name);
    if (score === "same" && p.dob === dob) return { status: "match", patientId: p.id, candidates: [{ patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn, why: "Same name and date of birth" }] };
    if (score === "close" && p.dob === dob) candidates.push({ patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn, why: "Same date of birth, name spelled differently" });
    else if (score === "same" && dobSwapped(dob, p.dob)) candidates.push({ patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn, why: "Same name, two digits of the date of birth swapped" });
  }
  return candidates.length ? { status: "possible", candidates } : { status: "new", candidates: [] };
}

export function findDuplicate(fax: Fax, others: Fax[]): Fax | undefined {
  const r = fax.referral;
  if (!r?.patient.name.value || !r.patient.dob.value) return undefined;
  const since = new Date(fax.createdAt).getTime() - DUPLICATE_DAYS * 86_400_000;
  return others
    .filter((o) => o.id !== fax.id && o.kind === "referral" && o.referral && new Date(o.createdAt).getTime() >= since && o.createdAt <= fax.createdAt)
    .find((o) => {
      const or = o.referral!;
      const samePatient = nameScore(or.patient.name.value ?? "", r.patient.name.value!) === "same" && or.patient.dob.value === r.patient.dob.value;
      const sameReferrer = Boolean(or.referring.npi.value && or.referring.npi.value === r.referring.npi.value) || (or.referring.name.value ?? "").toLowerCase() === (r.referring.name.value ?? "").toLowerCase();
      return samePatient && sameReferrer;
    });
}

// ---------- What is missing ----------

const ATTACHMENT_TYPES: Array<{ pattern: RegExp; type: PageType; label: string }> = [
  { pattern: /\b(ekg|ecg|electrocardiogram)\b/i, type: "ekg", label: "EKG" },
  { pattern: /\b(lab|labs|blood ?work|a1c|cmp|bmp|tsh|panel)\b/i, type: "labs", label: "Lab results" },
  { pattern: /\b(mri|ct|x-?ray|ultrasound|echo|echocardiogram|imaging|radiology|scan)\b/i, type: "imaging_report", label: "Imaging report" },
  { pattern: /\b(note|notes|office|visit|consult|h&p|history|progress|chart)\b/i, type: "clinical_note", label: "Office note" },
  { pattern: /\b(insurance|card)\b/i, type: "insurance_card", label: "Insurance card" },
  { pattern: /\b(med(ication)?s?( list)?)\b/i, type: "medication_list", label: "Medication list" },
];

export function computeChecks(fax: Fax): Check[] {
  const checks: Check[] = [];
  const pages = fax.pages;
  for (const p of pages) if (p.typeUnsure) checks.push({ id: `page-${p.n}`, level: "check", text: `Page ${p.n}: the page type could not be confirmed. Take a look.`, page: p.n });
  if (fax.kind !== "referral" || !fax.referral) return checks;
  const r = fax.referral;

  // Required fields
  for (const item of INTAKE.requiredForAll) {
    if (item.id === "diagnoses") {
      if (!r.diagnoses.some((d) => d.description.value || d.code.value)) checks.push({ id: "missing-diagnoses", level: "missing", text: `Missing: ${item.label}`, field: "diagnoses" });
      continue;
    }
    const f = getField(r, item.id);
    if (!f || f.status === "missing" || !f.value) checks.push({ id: `missing-${item.id}`, level: "missing", text: `Missing: ${item.label}`, field: item.id });
  }
  // Fields to look at
  const all: Array<[string, Field]> = [
    ...FIELD_PATHS.map((p) => [p, getField(r, p)!] as [string, Field]),
    ...r.diagnoses.flatMap((d, i) => [[`diagnoses.${i}.code`, d.code], [`diagnoses.${i}.description`, d.description]] as Array<[string, Field]>),
  ];
  for (const [path, f] of all) {
    if (f?.status === "check") checks.push({ id: `check-${path}`, level: "check", text: `${labelOf(path)}: ${f.note ?? "check this value"}`, field: path, page: f.page ?? undefined });
  }
  // Specialty
  const spec = specialtyConfig(r.specialty.value);
  if (!r.specialty.value) checks.push({ id: "missing-specialty", level: "missing", text: "Missing: which specialty the patient is referred to", field: "specialty" });
  else if (!spec) checks.push({ id: "specialty-not-offered", level: "check", text: `${INTAKE.practice.name} does not see ${r.specialty.value} referrals. Redirect the referral.`, field: "specialty" });

  // Pages the specialty needs, and pages the form says are attached
  const have = new Set(pages.map((p) => p.type));
  const asked = new Set<string>();
  for (const need of spec?.requiredPages ?? []) {
    if (!have.has(need.type as PageType)) {
      checks.push({ id: `missing-page-${need.type}`, level: "missing", text: `Missing: ${need.label} (${spec!.name} needs it)` });
      asked.add(need.type);
    }
  }
  for (const item of r.records_said_attached) {
    const t = ATTACHMENT_TYPES.find((a) => a.pattern.test(item));
    if (t && !have.has(t.type) && !asked.has(t.type)) {
      checks.push({ id: `missing-attachment-${t.type}`, level: "missing", text: `Missing: ${item} (the referral says it is attached, but no such page came through)` });
      asked.add(t.type);
    }
  }
  if (r.pages_stated && r.pages_stated > fax.pageCount) {
    checks.push({ id: "missing-pages", level: "missing", text: `Missing pages: the cover sheet says ${r.pages_stated} pages, ${fax.pageCount} came through` });
  }

  // Urgency, patient, duplicate
  const { conflict } = computeUrgency(r, pages);
  if (conflict) checks.push({ id: "urgency-conflict", level: "urgent", text: conflict, field: "urgency" });
  if (fax.urgency.level === "urgent" && !conflict) checks.push({ id: "urgent", level: "urgent", text: `Urgent referral. ${spec ? `Book within ${spec.urgentWithinDays} days.` : "Book as soon as possible."}` });
  if (fax.match?.status === "possible") checks.push({ id: "possible-match", level: "check", text: `Possible existing patient: ${fax.match.candidates.map((c) => `${c.name} (${c.mrn}, ${c.why.toLowerCase()})`).join("; ")}. Confirm or create a new patient.` });
  if (fax.duplicateOf) checks.push({ id: "duplicate", level: "check", text: "Possible duplicate: the same patient was referred by the same provider in the last 30 days." });
  return checks;
}

export const FIELD_LABELS: Record<string, string> = {
  "patient.name": "Patient name", "patient.dob": "Date of birth", "patient.sex": "Sex", "patient.phone": "Patient phone", "patient.address": "Address",
  "insurance.payer": "Insurance plan", "insurance.member_id": "Member ID", "insurance.group_number": "Group number",
  "referring.name": "Referring provider", "referring.npi": "NPI", "referring.practice": "Practice", "referring.phone": "Practice phone", "referring.fax": "Practice fax",
  specialty: "Specialty", urgency: "Urgency", reason: "Reason for referral",
};

export function labelOf(path: string): string {
  const d = path.match(/^diagnoses\.(\d+)\.(code|description)$/);
  if (d) return `Diagnosis ${+d[1] + 1} ${d[2] === "code" ? "code" : "description"}`;
  return FIELD_LABELS[path] ?? path;
}

// ---------- Queue ----------

/** Where the fax belongs now. A coordinator can always move it. */
export function routeQueue(fax: Fax): Queue {
  if (fax.appointmentId) return "booked";
  if (fax.kind && fax.kind !== "referral") return "other";
  if (!fax.referral) return "review";
  if (fax.checks.some((c) => c.level === "missing")) return "needs_info";
  if (fax.checks.some((c) => c.level === "check" || c.id === "urgency-conflict")) return "review";
  return "ready";
}

export const QUEUE_LABELS: Record<Queue, string> = {
  review: "Needs review",
  needs_info: "Needs info",
  ready: "Ready to book",
  booked: "Booked",
  other: "Not a referral",
};

/** Re-runs matching, urgency, checks and the queue after a coordinator changes something. */
export function refresh(fax: Fax, patients: Patient[], others: Fax[]): void {
  const r = fax.referral;
  if (r && fax.match?.status !== "confirmed" && fax.match?.status !== "created") fax.match = matchPatient(r.patient.name.value, r.patient.dob.value, patients);
  fax.urgency = computeUrgency(r, fax.pages).urgency;
  fax.duplicateOf = r ? findDuplicate(fax, others)?.id : undefined;
  fax.checks = computeChecks(fax);
  if (fax.queue !== "booked") fax.queue = routeQueue(fax);
}
