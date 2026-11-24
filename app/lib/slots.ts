/**
 * A simple clinic calendar for booking referred patients (step 6).
 *
 * Open slots come from config/intake.json: each specialty's providers, weekdays,
 * start to end time, one new-patient visit length. A fixed share of slots is shown
 * as already taken by other patients, so the calendar looks like a real one.
 * Replace this module with your scheduling system or EHR in production.
 */
import { createHash } from "node:crypto";
import { INTAKE, specialtyConfig } from "./config";
import type { Appointment, Slot } from "./types";

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Local clinic time is treated as UTC to keep the demo simple and stable. */
export function openSlots(specialty: string, booked: Appointment[], from = new Date()): Slot[] {
  const spec = specialtyConfig(specialty);
  if (!spec) return [];
  const { days, start, end, visitMinutes, takenShare } = INTAKE.schedule;
  const taken = new Set(booked.map((a) => a.slotId));
  const out: Slot[] = [];
  const day0 = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let d = 1; d <= days; d++) {
    const date = new Date(day0 + d * 86_400_000);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const ymd = date.toISOString().slice(0, 10);
    for (const provider of spec.providers) {
      for (let t = minutes(start); t + visitMinutes <= minutes(end); t += visitMinutes) {
        const id = `${spec.name}|${provider}|${ymd}|${t}`.replace(/[^A-Za-z0-9|.-]/g, "_");
        // Deterministic "already booked by someone else".
        const h = parseInt(createHash("sha1").update(id).digest("hex").slice(0, 8), 16) / 0xffffffff;
        if (h < takenShare || taken.has(id)) continue;
        out.push({ id, start: new Date(day0 + d * 86_400_000 + t * 60_000).toISOString(), minutes: visitMinutes, specialty: spec.name, provider });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.provider.localeCompare(b.provider));
}

export function findSlot(slotId: string, booked: Appointment[]): Slot | undefined {
  const specialty = slotId.split("|")[0];
  return openSlots(specialty, booked).find((s) => s.id === slotId);
}

/** The latest day an urgent referral should be seen. */
export function bookBy(specialty: string | null | undefined, from = new Date()): string | null {
  const spec = specialtyConfig(specialty);
  if (!spec) return null;
  return new Date(from.getTime() + spec.urgentWithinDays * 86_400_000).toISOString();
}
