import type { FaxKind, PageType } from "./types";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Slot times are clinic time stored as UTC (see lib/slots.ts). */
export function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

export function formatDayOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export const KIND_LABELS: Record<FaxKind, string> = {
  referral: "Referral",
  records_for_existing_patient: "Records for a patient",
  pharmacy_or_refill: "Pharmacy or refill request",
  prior_auth: "Prior authorization",
  marketing_or_junk: "Marketing or junk",
  other: "Other fax",
};

export const PAGE_LABELS: Record<PageType, string> = {
  cover_sheet: "Cover sheet",
  referral_form: "Referral form",
  clinical_note: "Office note",
  labs: "Lab results",
  ekg: "EKG",
  imaging_report: "Imaging report",
  insurance_card: "Insurance card",
  medication_list: "Medication list",
  pharmacy_request: "Pharmacy request",
  other: "Other page",
};
