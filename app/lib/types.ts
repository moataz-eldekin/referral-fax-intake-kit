// Shared types used by the server and the browser.

export type Role = "admin" | "coordinator";

/** A logged-in account as the app sees it (never includes the password hash). */
export type User = { id: string; role: Role; email: string; name: string; createdAt: string };
export type StoredAccount = User & { passwordHash: string };

/** A friendly error that is safe to show in the UI. */
export type AppError = { title: string; message: string; status?: number | null; code?: string; requestId?: string };

/** One request made to Sully, recorded for the developer panel. */
export type ApiCall = {
  id: string;
  label: string;
  method: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody?: string; // truncated for display
  status: number | null;
  ok: boolean;
  latencyMs: number;
  requestId?: string;
  responsePreview?: string;
  error?: string;
  curl: string;
  demo: boolean;
  note?: string;
  usage?: { promptTokens: number; completionTokens: number };
  at: string;
};

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

// ---------- Pages ----------

export type Box = [number, number, number, number]; // x0, y0, x1, y1 in page pixels
export type OcrWord = { text: string; conf: number; box: Box };

export const PAGE_TYPES = [
  "cover_sheet",
  "referral_form",
  "clinical_note",
  "labs",
  "ekg",
  "imaging_report",
  "insurance_card",
  "medication_list",
  "pharmacy_request",
  "other",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export type FaxPage = {
  n: number;
  width: number;
  height: number;
  text: string;
  words: OcrWord[];
  confidence: number;
  /** From Sully M1 (step 2). */
  type?: PageType;
  typeEvidence?: string | null;
  /** True when M1's evidence quote was not found on the page, so the type needs a look. */
  typeUnsure?: boolean;
};

// ---------- What kind of fax ----------

export const FAX_KINDS = ["referral", "records_for_existing_patient", "pharmacy_or_refill", "prior_auth", "marketing_or_junk", "other"] as const;
export type FaxKind = (typeof FAX_KINDS)[number];

// ---------- Referral fields (step 3) ----------

/** found = quote found on the page; check = needs a look; missing = not on the fax; confirmed/edited = a coordinator checked it. */
export type FieldStatus = "found" | "check" | "missing" | "confirmed" | "edited";

export type Field = {
  value: string | null;
  quote: string | null;
  page: number | null;
  status: FieldStatus;
  note?: string;
  /** Word boxes of the quote on its page, for highlighting. */
  boxes?: Box[];
  /** The value read from the fax, kept when a coordinator edits it. */
  original?: string | null;
};

export type Diagnosis = { code: Field; description: Field };

export type Referral = {
  patient: { name: Field; dob: Field; sex: Field; phone: Field; address: Field };
  insurance: { payer: Field; member_id: Field; group_number: Field };
  referring: { name: Field; npi: Field; practice: Field; phone: Field; fax: Field };
  specialty: Field;
  urgency: Field;
  reason: Field;
  diagnoses: Diagnosis[];
  records_said_attached: string[];
  pages_stated: number | null;
  handwritten_notes: string[];
};

// ---------- Checks (step 5) ----------

export type CheckLevel = "missing" | "check" | "urgent" | "info";
export type Check = { id: string; level: CheckLevel; text: string; page?: number; field?: string };

export type Urgency = { level: "routine" | "urgent"; reasons: string[] };

// ---------- Patients and visits ----------

export type Patient = { id: string; mrn: string; name: string; dob: string; phone?: string; createdAt: string; fromFaxId?: string };

export type PatientMatch = {
  status: "match" | "possible" | "new" | "confirmed" | "created";
  patientId?: string;
  candidates: Array<{ patientId: string; name: string; dob: string; mrn: string; why: string }>;
};

export type Appointment = {
  id: string;
  slotId: string;
  start: string; // ISO
  minutes: number;
  specialty: string;
  provider: string;
  patientId: string;
  patientName: string;
  faxId: string;
  bookedBy: string;
  bookedAt: string;
};

export type Slot = { id: string; start: string; minutes: number; specialty: string; provider: string };

// ---------- Queues (step 6) ----------

export const QUEUES = ["review", "needs_info", "ready", "booked", "other"] as const;
export type Queue = (typeof QUEUES)[number];

export type FaxBack = { text: string; source: "m1" | "rewritten" | "template" | "edited"; issues?: string[] };

export type RunStep = {
  status: "idle" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  progress?: string;
  error?: AppError;
};

export type HistoryEvent = { at: string; by: string; text: string };

export type Fax = {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: "upload" | "sample" | "fax_service";
  fileName: string;
  fromFax?: string;
  sample?: string;
  pageCount: number;
  pages: FaxPage[];
  kind?: FaxKind;
  kindRationale?: string;
  referral?: Referral;
  checks: Check[];
  urgency: Urgency;
  match?: PatientMatch;
  duplicateOf?: string;
  faxBack?: FaxBack;
  queue: Queue;
  appointmentId?: string;
  run: RunStep;
  history: HistoryEvent[];
  calls: ApiCall[];
  /** Hashes of what each Sully step was run on, so a re-run only pays for what changed. */
  cache?: { classify?: string; extract?: string; faxBack?: string };
  /** Raw Sully results kept with the cache. */
  raw?: { classify?: unknown; extract?: unknown };
};

/** The fax list row (no page text). */
export type FaxSummary = Pick<
  Fax,
  "id" | "createdAt" | "source" | "fileName" | "fromFax" | "pageCount" | "kind" | "queue" | "urgency" | "run" | "appointmentId" | "duplicateOf"
> & { patientName: string | null; specialty: string | null; referringPractice: string | null; toCheck: number; missing: number };
