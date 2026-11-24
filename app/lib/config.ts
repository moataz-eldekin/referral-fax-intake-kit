import path from "node:path";
import intake from "@/config/intake.json";

/** Local store for accounts, faxes, page images, patients and visits (gitignored). */
export const DATA_DIR = path.join(process.cwd(), "data");

/** Sample faxes and seed patients shipped with the kit. */
export const TEST_DATA_DIR = path.join(process.cwd(), "test-data");

/** English OCR model, shipped as an npm package so nothing is downloaded at runtime. */
export const TESSDATA_DIR = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");

/** Upload limits. Fax services send PDF or TIFF; scans are usually PNG or JPG. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 20;
/** PDF pages are rendered at 200 dpi, the resolution of a fine-mode fax. */
export const RENDER_DPI = 200;
/** OCR lines below this confidence are marked low. */
export const LOW_CONFIDENCE = 60;
/** Two referrals for the same patient from the same NPI within this many days are a possible duplicate. */
export const DUPLICATE_DAYS = 30;

export type IntakeConfig = typeof intake;
export type SpecialtyConfig = IntakeConfig["specialties"][number];
export const INTAKE: IntakeConfig = intake;

export function specialtyConfig(name: string | null | undefined): SpecialtyConfig | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return INTAKE.specialties.find((s) => s.name.toLowerCase() === n || n.includes(s.name.toLowerCase()));
}

export type SullyConfig = {
  accountId: string;
  apiKey: string;
  baseUrl: string;
  demo: boolean;
};

/** Reads Sully settings from .env.local. Without an API key the app runs in demo mode. */
export function getSullyConfig(): SullyConfig {
  const apiKey = (process.env.SULLY_API_KEY ?? "").trim();
  const accountId = (process.env.SULLY_ACCOUNT_ID ?? "").trim();
  const baseUrl = ((process.env.SULLY_API_BASE_URL ?? "").trim() || "https://api.sully.ai").replace(/\/+$/, "");
  return { accountId, apiKey, baseUrl, demo: apiKey === "" };
}

export function isDemoMode(): boolean {
  return getSullyConfig().demo;
}

/** Shared secret a fax service sends to POST /api/inbound-fax. Empty = the endpoint is off. */
export function faxWebhookSecret(): string {
  return (process.env.FAX_WEBHOOK_SECRET ?? "").trim();
}
