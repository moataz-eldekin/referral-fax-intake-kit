/**
 * Step 3 of the pipeline: Sully Text to JSON pulls the referral details out of the OCR text.
 *
 * One request per fax with every page under a "--- Page n of N ---" header.
 * Every value comes with a short quote and the page it came from, so the
 * server can check it against the page and highlight it for the coordinator.
 */
import { textToJson } from "./sully";
import type { ApiCall, FaxPage } from "./types";

const cell = (description: string) => ({
  type: "object",
  description,
  properties: {
    value: { type: ["string", "null"], description: "The value. Null if it is not on the fax, or the field is blank or just a line." },
    quote: { type: ["string", "null"], description: "3 to 15 words copied exactly from the text, including the label next to the value, e.g. 'Member ID: W123456789'. Null when value is null." },
    page: { type: ["integer", "null"], description: "The page number the quote is on." },
  },
  required: ["value", "quote", "page"],
  additionalProperties: false,
});

const group = (fields: Record<string, string>) => ({
  type: "object",
  properties: Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, cell(d)])),
  required: Object.keys(fields),
  additionalProperties: false,
});

/** The JSON Schema sent to Text to JSON. The descriptions carry the extraction rules. */
export const REFERRAL_SCHEMA = {
  type: "object",
  properties: {
    patient: group({
      name: "Patient full name as written, e.g. 'OKAFOR, GERALD'.",
      dob: "Patient date of birth as YYYY-MM-DD. Expand two-digit years to 19xx if that makes the patient older than 1, else 20xx.",
      sex: "Patient sex as written (M, F, male, female). Null if not stated.",
      phone: "Patient phone number as written.",
      address: "Patient home address as written.",
    }),
    insurance: group({
      payer: "Insurance company or plan name, e.g. 'Aetna Medicare Advantage'.",
      member_id: "Insurance member or subscriber ID. Null if the field is blank or a line.",
      group_number: "Insurance group number. Null if not stated.",
    }),
    referring: group({
      name: "Name of the referring clinician (not this clinic).",
      npi: "The referring clinician's 10-digit NPI as written.",
      practice: "The referring practice or organization name.",
      phone: "The referring practice phone number.",
      fax: "The referring practice fax number (often in the fax header line or on the cover sheet).",
    }),
    specialty: cell("The specialty the patient is referred to: only the ticked box or the specialty named in the request."),
    urgency: cell("Urgency of the referral: 'routine', 'urgent' or 'stat', from a ticked box or explicit words such as urgent, stat, ASAP or 'within 7 days'. Null if not stated."),
    reason: cell("Reason for referral: the clinical question or request, as written, up to 40 words."),
    diagnoses: {
      type: "array",
      description: "Diagnoses on the referral, each with its ICD-10 code if written.",
      items: {
        type: "object",
        properties: {
          code: cell("ICD-10 code as it should read, e.g. 'R07.89'. Null if no code is written."),
          description: cell("Diagnosis description as written."),
        },
        required: ["code", "description"],
        additionalProperties: false,
      },
    },
    records_said_attached: {
      type: "array",
      description: "Records the form or cover sheet says are attached or enclosed, in a few words each, e.g. 'Last office note', 'EKG'. For checkboxes, include only ticked ones: [X], X] or ☒. A box that reads [ ], [], [J, [1, [l or a lone [ is EMPTY: leave that item out.",
      items: { type: "string" },
    },
    pages_stated: { type: ["integer", "null"], description: "Total number of pages the cover sheet says were sent. Null if not stated." },
    handwritten_notes: {
      type: "array",
      description: "Any handwritten or added note, copied as written (signatures excluded).",
      items: { type: "string" },
    },
  },
  required: ["patient", "insurance", "referring", "specialty", "urgency", "reason", "diagnoses", "records_said_attached", "pages_stated", "handwritten_notes"],
  additionalProperties: false,
} as const;

export function extractInput(pages: FaxPage[]): string {
  const body = pages.map((p) => `--- Page ${p.n} of ${pages.length} ---\n${p.text}`).join("\n\n");
  return `Inbound fax, OCR text. It may contain OCR errors such as 0/O, 1/I, 5/S. Checkboxes may read as [X], [J], X or be missing.\n\n${body}`;
}

export async function extractReferral(pages: FaxPage[]): Promise<{ raw: unknown; call: ApiCall }> {
  const { data, call } = await textToJson<unknown>(extractInput(pages), REFERRAL_SCHEMA, "Extract the referral");
  return { raw: data, call };
}

// ---------- Defensive cleanup (the schema checks structure, not content) ----------

export type Cell = { value: string | null; quote: string | null; page: number | null };
export type RawReferral = {
  patient: Record<"name" | "dob" | "sex" | "phone" | "address", Cell>;
  insurance: Record<"payer" | "member_id" | "group_number", Cell>;
  referring: Record<"name" | "npi" | "practice" | "phone" | "fax", Cell>;
  specialty: Cell;
  urgency: Cell;
  reason: Cell;
  diagnoses: Array<{ code: Cell; description: Cell }>;
  records_said_attached: string[];
  pages_stated: number | null;
  handwritten_notes: string[];
};

const PLACEHOLDER = /^(n\/?a|none|unknown|not (stated|specified|documented|provided|given)|null|blank|[-_.\s]+)$/i;

function text(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  return t.slice(0, max);
}

function cellOf(v: unknown, max = 300): Cell {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const value = text(r.value, max);
  const page = Number.isInteger(r.page) ? (r.page as number) : null;
  return { value, quote: value ? text(r.quote, 300) : null, page: value ? page : null };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function strings(v: unknown, max = 200): string[] {
  return Array.isArray(v) ? v.map((x) => text(x, max)).filter((x): x is string => Boolean(x)).slice(0, 20) : [];
}

export function cleanReferral(raw: unknown): RawReferral {
  const r = obj(raw);
  const p = obj(r.patient);
  const i = obj(r.insurance);
  const f = obj(r.referring);
  const out: RawReferral = {
    patient: { name: cellOf(p.name, 120), dob: cellOf(p.dob, 40), sex: cellOf(p.sex, 20), phone: cellOf(p.phone, 40), address: cellOf(p.address, 200) },
    insurance: { payer: cellOf(i.payer, 120), member_id: cellOf(i.member_id, 40), group_number: cellOf(i.group_number, 40) },
    referring: { name: cellOf(f.name, 120), npi: cellOf(f.npi, 30), practice: cellOf(f.practice, 160), phone: cellOf(f.phone, 40), fax: cellOf(f.fax, 40) },
    specialty: cellOf(r.specialty, 80),
    urgency: cellOf(r.urgency, 20),
    reason: cellOf(r.reason, 400),
    diagnoses: (Array.isArray(r.diagnoses) ? r.diagnoses : [])
      .map((d) => ({ code: cellOf(obj(d).code, 12), description: cellOf(obj(d).description, 160) }))
      .filter((d) => d.code.value || d.description.value)
      .slice(0, 12),
    records_said_attached: strings(r.records_said_attached, 80),
    pages_stated: Number.isInteger(r.pages_stated) && (r.pages_stated as number) > 0 && (r.pages_stated as number) < 200 ? (r.pages_stated as number) : null,
    handwritten_notes: strings(r.handwritten_notes, 300),
  };
  // Normalize the few values the checks compare.
  const u = out.urgency.value?.toLowerCase() ?? "";
  out.urgency.value = /stat/.test(u) ? "stat" : /urgent|asap|soon|week|days?/.test(u) ? "urgent" : /routine/.test(u) ? "routine" : out.urgency.value ? out.urgency.value.toLowerCase() : null;
  for (const c of [out.referring.npi]) if (c.value) c.value = c.value.replace(/\D/g, "") || c.value;
  for (const d of out.diagnoses) if (d.code.value) d.code.value = d.code.value.toUpperCase().replace(/\s+/g, "");
  return out;
}
