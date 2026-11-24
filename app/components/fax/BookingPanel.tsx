"use client";

import { AlertTriangle, CalendarCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/Button";
import { api, asAppError } from "@/lib/client";
import { formatDayOnly, formatSlot } from "@/lib/format";
import type { Appointment, Fax, Slot } from "@/lib/types";

/** Step 6: book the referred patient into an open new-patient slot. */
export function BookingPanel({
  fax,
  appointment,
  canEdit,
  onChanged,
}: {
  fax: Omit<Fax, "raw">;
  appointment: Appointment | null;
  canEdit: boolean;
  onChanged: (f: Omit<Fax, "raw">) => void;
}) {
  const specialty = fax.referral?.specialty.value ?? "";
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [bookBy, setBookBy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = fax.match;
  const patientReady = m && (m.status === "match" || m.status === "confirmed" || m.status === "created");
  const urgent = fax.urgency.level === "urgent";
  const blockers = fax.checks.filter((c) => c.level === "missing" || c.level === "check").length;

  useEffect(() => {
    if (fax.appointmentId || !specialty) return;
    api<{ slots: Slot[]; bookBy: string | null }>(`/api/slots?specialty=${encodeURIComponent(specialty)}`)
      .then((r) => {
        setSlots(r.slots);
        setBookBy(r.bookBy);
      })
      .catch((err) => setError(asAppError(err).message));
  }, [specialty, fax.appointmentId]);

  const days = useMemo(() => {
    const byDay = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const d = s.start.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(s);
    }
    return [...byDay.entries()].slice(0, 8);
  }, [slots]);

  async function book() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const { fax: f } = await api<{ fax: Omit<Fax, "raw"> }>(`/api/faxes/${fax.id}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotId: chosen }) });
      onChanged(f);
    } catch (err) {
      setError(asAppError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this visit? The referral goes back to the queue.")) return;
    setBusy(true);
    try {
      const { fax: f } = await api<{ fax: Omit<Fax, "raw"> }>(`/api/faxes/${fax.id}/book`, { method: "DELETE" });
      onChanged(f);
    } catch (err) {
      setError(asAppError(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (fax.appointmentId) {
    return (
      <Panel title="Visit booked">
        {appointment ? (
          <p className="flex items-center gap-2">
            <CalendarCheck aria-hidden className="h-5 w-5" strokeWidth={1.5} />
            {formatSlot(appointment.start)} with {appointment.provider} ({appointment.specialty}), booked by {appointment.bookedBy}.
          </p>
        ) : (
          <p>Booked.</p>
        )}
        {canEdit ? (
          <Button variant="secondary" size="sm" className="self-start" disabled={busy} onClick={cancel}>
            Cancel visit
          </Button>
        ) : null}
        {error ? <p className="text-[12px]" role="alert">{error}</p> : null}
      </Panel>
    );
  }

  return (
    <Panel title="Book the visit">
      {!specialty ? <p className="text-[14px] text-graphite">Fill in the specialty to see open times.</p> : null}
      {urgent && bookBy ? (
        <p className="flex items-center gap-2 rounded-[12px] border-2 border-ink p-3 text-[14px]">
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.5} /> Urgent: book by {formatDayOnly(bookBy)}. Times after that are marked.
        </p>
      ) : null}
      {!patientReady ? <p className="text-[14px] text-graphite">Confirm the existing patient or create a new one first.</p> : null}
      {blockers ? <p className="text-[14px] text-graphite">{blockers} item{blockers === 1 ? "" : "s"} still missing or to check. You can still book, for example while the missing items are requested.</p> : null}
      {slots && !slots.length ? <p className="text-[14px] text-graphite">No open times in the next three weeks.</p> : null}
      <div className="flex flex-col gap-3">
        {days.map(([day, list]) => (
          <div key={day} className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-graphite">{formatDayOnly(`${day}T12:00:00Z`)}</span>
            <div className="flex flex-wrap gap-2">
              {list.slice(0, 6).map((s) => {
                const late = urgent && bookBy && s.start > bookBy;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!canEdit || !patientReady}
                    onClick={() => setChosen(s.id)}
                    aria-pressed={chosen === s.id}
                    className={`rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-50 ${chosen === s.id ? "border-ink bg-ink text-paper" : late ? "border-dashed border-silver bg-paper" : "border-fog bg-paper hover:bg-cream"}`}
                    title={late ? "After the urgent book-by date" : undefined}
                  >
                    {formatSlot(s.start).split(", ").pop()} · {s.provider.split(",")[0]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {canEdit ? (
        <Button className="self-start" disabled={!chosen || !patientReady || busy} onClick={book}>
          {busy ? "Booking..." : "Book this time"}
        </Button>
      ) : null}
      {error ? <p className="text-[12px]" role="alert">{error}</p> : null}
    </Panel>
  );
}
