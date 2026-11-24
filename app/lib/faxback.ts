/**
 * Step 5b: Sully M1 drafts the body of a fax back to the referring office,
 * asking for the missing items. The cover header and the closing line are fixed
 * app text. The draft is checked with a word list; one rewrite, then a fixed template.
 */
import { INTAKE } from "./config";
import { chat, M1_MODEL, type ChatRequest } from "./sully";
import type { ApiCall, Check, FaxBack, Referral } from "./types";

const RULES = [
  { label: "says the visit is booked or promises a time", pattern: /\b(scheduled|booked|has an appointment|appointment (is|has been)|will be seen|we will see|we('| wi)ll call|will contact|reach out to the patient|on the schedule)\b/i },
  { label: "gives clinical advice or an opinion", pattern: /\b(recommend|should (start|stop|take|go|continue|be)|consider|we suggest|advise|likely|probably|appears to|consistent with|diagnos(is|ed|e))\b/i },
  { label: "names a medicine or dose", pattern: /\b\d+(\.\d+)?\s?(mg|mcg|ml|units?)\b/i },
  { label: "uses an em dash or emoji", pattern: /[—\u{1F300}-\u{1FAFF}]/u },
];

export function checkFaxBack(text: string): string[] {
  return RULES.filter((r) => r.pattern.test(text)).map((r) => r.label);
}

/** The items to ask for, in plain words, from the "missing" checks. */
export function missingItems(checks: Check[]): string[] {
  return checks
    .filter((c) => c.level === "missing")
    .map((c) =>
      c.text
        .replace(/^Missing:\s*/i, "")
        .replace(/\s*\(the referral says it is attached[^)]*\)/i, " (listed as attached, not received)")
        .replace(/\s*\([A-Za-z]+ needs it\)/, ""),
    );
}

const SYSTEM = `You write the body of a short fax from a specialty clinic's intake team to a referring office, asking for items missing from a referral.

Rules:
- Start with one sentence saying the clinic received the referral for the patient (name and date of birth as given) and needs the items below to process it.
- Then list each missing item on its own line starting with "- ", in plain words, in the order given. Do not add items.
- Then one sentence asking them to fax the items to the clinic's fax number (given).
- Never say or imply the patient is scheduled, booked or will be seen, or that anyone will call. Never give clinical advice, opinions or diagnoses. Do not mention medicines.
- No other patient details. No greeting line, no signature, no subject line: the app adds the header and the closing.
- Plain text. No emojis, no em dashes.`;

export function faxBackRequest(r: Referral, items: string[], fix?: string[]): ChatRequest {
  const user = [
    `Clinic: ${INTAKE.practice.name}, fax ${INTAKE.practice.fax}`,
    `Referring office: ${r.referring.practice.value ?? "unknown"}${r.referring.name.value ? `, ${r.referring.name.value}` : ""}`,
    `Patient: ${r.patient.name.value ?? "name not given"}, date of birth ${r.patient.dob.value ?? "not given"}`,
    `Missing items:\n${items.map((i) => `- ${i}`).join("\n")}`,
    fix ? `Your last draft ${fix.join(" and ")}. Write it again without that.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    model: M1_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_completion_tokens: 600,
    reasoning_effort: "none",
  };
}

export function templateFaxBack(r: Referral, items: string[]): string {
  return [
    `We received a referral for ${r.patient.name.value ?? "your patient"}${r.patient.dob.value ? `, date of birth ${r.patient.dob.value}` : ""}. To process it, we need the following:`,
    ...items.map((i) => `- ${i}`),
    `Please fax these to ${INTAKE.practice.fax}.`,
  ].join("\n");
}

/** Fixed header and closing around the body. Never model output. */
export function wrapFaxBack(r: Referral): { header: string; closing: string } {
  const today = new Date().toISOString().slice(0, 10);
  return {
    header: [
      `TO: ${r.referring.practice.value ?? r.referring.name.value ?? "Referring office"}${r.referring.fax.value ? `   FAX: ${r.referring.fax.value}` : ""}`,
      `FROM: ${INTAKE.practice.name} Intake   FAX: ${INTAKE.practice.fax}   PHONE: ${INTAKE.practice.phone}`,
      `DATE: ${today}   RE: Referral for ${r.patient.name.value ?? "patient"}, information needed`,
    ].join("\n"),
    closing: `Questions: call ${INTAKE.practice.phone}. This fax contains protected health information. If you received it in error, call us and destroy all copies.`,
  };
}

export async function draftFaxBack(r: Referral, checks: Check[]): Promise<{ faxBack: FaxBack; calls: ApiCall[] }> {
  const items = missingItems(checks);
  const calls: ApiCall[] = [];
  const first = await chat(faxBackRequest(r, items), "Draft the request for missing items");
  calls.push(first.call);
  let text = first.content.trim();
  let issues = checkFaxBack(text);
  if (text && !issues.length) return { faxBack: { text, source: "m1" }, calls };
  const second = await chat(faxBackRequest(r, items, issues.length ? issues : ["was empty"]), "Rewrite the request for missing items");
  calls.push(second.call);
  text = second.content.trim();
  const again = checkFaxBack(text);
  if (text && !again.length) return { faxBack: { text, source: "rewritten", issues }, calls };
  issues = [...issues, ...again];
  return { faxBack: { text: templateFaxBack(r, items), source: "template", issues }, calls };
}
