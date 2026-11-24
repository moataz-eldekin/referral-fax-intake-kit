"use client";

import { AlertTriangle, Check, CircleAlert, LoaderCircle, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiCallsPanel } from "@/components/ApiCallsPanel";
import { Panel } from "@/components/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { FIELD_LABELS, QUEUE_LABELS } from "@/lib/checks";
import { api, asAppError, postJson } from "@/lib/client";
import { formatDate, KIND_LABELS } from "@/lib/format";
import type { AppError, Appointment, Box, Fax, Field, FieldStatus, Queue } from "@/lib/types";
import { BookingPanel } from "./BookingPanel";
import { PageViewer } from "./PageViewer";

type Props = { initial: Omit<Fax, "raw">; canEdit: boolean; appointment: Appointment | null; faxBackHeader: { header: string; closing: string } | null };

const STATUS: Record<FieldStatus, { label: string; tone: "fog" | "sky" | "outline" }> = {
  found: { label: "Found", tone: "outline" },
  check: { label: "Check", tone: "sky" },
  missing: { label: "Missing", tone: "fog" },
  confirmed: { label: "Confirmed", tone: "outline" },
  edited: { label: "Edited", tone: "outline" },
};

const GROUPS: Array<{ title: string; paths: string[] }> = [
  { title: "Patient", paths: ["patient.name", "patient.dob", "patient.sex", "patient.phone", "patient.address"] },
  { title: "Insurance", paths: ["insurance.payer", "insurance.member_id", "insurance.group_number"] },
  { title: "Referring provider", paths: ["referring.name", "referring.npi", "referring.practice", "referring.phone", "referring.fax"] },
  { title: "Referral", paths: ["specialty", "urgency", "reason"] },
];

function fieldAt(fax: Omit<Fax, "raw">, path: string): Field | undefined {
  let cur: unknown = fax.referral;
  for (const p of path.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
  return cur as Field | undefined;
}

export function FaxView({ initial, canEdit, appointment, faxBackHeader }: Props) {
  const router = useRouter();
  const [fax, setFax] = useState(initial);
  const [page, setPage] = useState(1);
  const [highlight, setHighlight] = useState<Box[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const running = fax.run.status === "running";

  const reload = useCallback(async () => {
    const { fax: f } = await api<{ fax: Omit<Fax, "raw"> }>(`/api/faxes/${fax.id}`);
    setFax(f);
    return f;
  }, [fax.id]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      reload()
        .then((f) => {
          if (f.run.status !== "running") router.refresh();
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [running, reload, router]);

  async function act(key: string, fn: () => Promise<{ fax?: Omit<Fax, "raw"> } | void>) {
    setBusy(key);
    setError(null);
    try {
      const out = await fn();
      if (out && out.fax) setFax(out.fax);
      router.refresh();
    } catch (err) {
      setError(asAppError(err));
    } finally {
      setBusy(null);
    }
  }

  function show(path: string, f: Field | undefined) {
    setSelected(path);
    if (f?.page) setPage(f.page);
    setHighlight(f?.boxes ?? []);
  }

  const r = fax.referral;
  const first = r?.patient.name.value ? nameFirst(r.patient.name.value) : null;
  const missing = fax.checks.filter((c) => c.level === "missing");
  const looks = fax.checks.filter((c) => c.level === "check");
  const urgentChecks = fax.checks.filter((c) => c.level === "urgent");

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-[1280px] flex-wrap items-end justify-between gap-6 px-6 pt-10 pb-8">
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-graphite">
            {fax.source === "fax_service" ? "From the fax service" : fax.source === "sample" ? "Sample fax" : "Uploaded"} · {formatDate(fax.createdAt)}
            {fax.fromFax ? ` · from ${fax.fromFax}` : ""} · {fax.pageCount} page{fax.pageCount === 1 ? "" : "s"}
          </p>
          <h1 className="font-serif text-[40px] leading-[1.1] tracking-[-0.03em] md:text-[48px]">
            {fax.kind === "referral" || !fax.kind ? (
              <>
                {first ? `${first}'s` : "New"} <span className="text-sky">referral</span>
              </>
            ) : (
              <span>{KIND_LABELS[fax.kind]}</span>
            )}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge>{running ? "Reading" : QUEUE_LABELS[fax.queue]}</Badge>
            {fax.kind === "referral" && fax.urgency.level === "urgent" ? (
              <Badge tone="sky">
                <AlertTriangle aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> Urgent
              </Badge>
            ) : null}
            {r?.specialty.value ? <Badge tone="outline">{r.specialty.value}</Badge> : null}
            {fax.kind && fax.kind !== "referral" ? <Badge tone="outline">Not a referral</Badge> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={running || Boolean(busy) || Boolean(fax.appointmentId)} onClick={() => act("run", () => postJson(`/api/faxes/${fax.id}/run`, {}).then(reload).then((f) => ({ fax: f })))}>
              <RotateCcw aria-hidden className="h-4 w-4" strokeWidth={1.5} /> Run again
            </Button>
            <Button
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() => {
                if (!window.confirm("Delete this fax, its pages and any visit booked from it?")) return;
                act("delete", async () => {
                  await api(`/api/faxes/${fax.id}`, { method: "DELETE" });
                  router.push("/");
                });
              }}
            >
              <Trash2 aria-hidden className="h-4 w-4" strokeWidth={1.5} /> Delete
            </Button>
          </div>
        ) : null}
      </section>

      <section className="flex-1 bg-cream">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-10">
          {error ? <ErrorNotice error={error} /> : null}
          {running ? (
            <div className="flex items-center gap-3 rounded-[16px] border border-fog bg-paper p-5">
              <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" strokeWidth={1.5} />
              <span>{fax.run.progress ?? "Working"}</span>
            </div>
          ) : null}
          {fax.run.status === "error" && fax.run.error ? <ErrorNotice error={fax.run.error} /> : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <PageViewer faxId={fax.id} pages={fax.pages} current={page} onPage={(n) => { setPage(n); setHighlight([]); setSelected(null); }} highlight={highlight} />
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              {fax.kind && fax.kind !== "referral" ? (
                <Panel title="Not a referral">
                  <p>{fax.kindRationale || "This fax is not a referral."}</p>
                  <p className="text-[14px] text-graphite">It is in the &ldquo;Not a referral&rdquo; queue. If it is a referral after all, move it to Needs review and run the intake again.</p>
                </Panel>
              ) : null}

              {fax.checks.length ? (
                <Panel title="Checks">
                  <ul className="flex flex-col gap-2">
                    {[...urgentChecks, ...missing, ...looks, ...fax.checks.filter((c) => c.level === "info")].map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (c.field) show(c.field, fieldAt(fax, c.field));
                            else if (c.page) setPage(c.page);
                          }}
                          className={`flex w-full items-start gap-3 rounded-[12px] p-3 text-left text-[14px] hover:bg-cream ${c.level === "urgent" ? "border-2 border-ink" : "border border-fog"}`}
                        >
                          {c.level === "urgent" ? <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} /> : <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />}
                          <span className="flex-1">{c.text}</span>
                          <span className="shrink-0 text-[12px] text-graphite">{c.level === "missing" ? "Missing" : c.level === "check" ? "Check" : c.level === "urgent" ? "Urgent" : ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {fax.urgency.level === "urgent" && fax.urgency.reasons.length ? (
                    <div className="text-[12px] text-graphite">
                      Why urgent: {fax.urgency.reasons.join(" ")}
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {r ? (
                <Panel title="Referral details" actions={<span className="text-[12px] text-graphite">Click a field to see it on the page</span>}>
                  {GROUPS.map((g) => (
                    <div key={g.title} className="flex flex-col gap-1">
                      <h3 className="text-[12px] font-semibold tracking-[0.04em] text-graphite uppercase">{g.title}</h3>
                      {g.paths.map((p) => (
                        <FieldRow key={p} faxId={fax.id} path={p} label={FIELD_LABELS[p]} field={fieldAt(fax, p)!} selected={selected === p} onShow={() => show(p, fieldAt(fax, p))} canEdit={canEdit && !fax.appointmentId} onSaved={setFax} />
                      ))}
                    </div>
                  ))}
                  <div className="flex flex-col gap-1">
                    <h3 className="text-[12px] font-semibold tracking-[0.04em] text-graphite uppercase">Diagnoses</h3>
                    {r.diagnoses.length === 0 ? <p className="text-[14px] text-graphite">None found on the fax.</p> : null}
                    {r.diagnoses.map((d, i) => (
                      <div key={i} className="grid grid-cols-[140px_1fr] gap-2">
                        <FieldRow faxId={fax.id} path={`diagnoses.${i}.code`} label="Code" field={d.code} selected={selected === `diagnoses.${i}.code`} onShow={() => show(`diagnoses.${i}.code`, d.code)} canEdit={canEdit && !fax.appointmentId} onSaved={setFax} compact />
                        <FieldRow faxId={fax.id} path={`diagnoses.${i}.description`} label="Description" field={d.description} selected={selected === `diagnoses.${i}.description`} onShow={() => show(`diagnoses.${i}.description`, d.description)} canEdit={canEdit && !fax.appointmentId} onSaved={setFax} compact />
                      </div>
                    ))}
                  </div>
                  {r.records_said_attached.length || r.pages_stated || r.handwritten_notes.length ? (
                    <div className="flex flex-col gap-1 text-[14px]">
                      {r.records_said_attached.length ? <p><span className="text-graphite">Says attached:</span> {r.records_said_attached.join(", ")}</p> : null}
                      {r.pages_stated ? <p><span className="text-graphite">Cover says:</span> {r.pages_stated} pages ({fax.pageCount} received)</p> : null}
                      {r.handwritten_notes.length ? <p><span className="text-graphite">Handwritten:</span> {r.handwritten_notes.map((n) => `"${n}"`).join(", ")}</p> : null}
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {r && fax.match ? <PatientPanel fax={fax} canEdit={canEdit && !fax.appointmentId} busy={busy} act={act} /> : null}

              {r && missing.length ? <FaxBackPanel key={fax.faxBack?.text ?? ""} fax={fax} canEdit={canEdit} header={faxBackHeader} onSaved={(fb) => setFax({ ...fax, faxBack: fb })} /> : null}

              {r ? (
                <BookingPanel
                  fax={fax}
                  appointment={appointment}
                  canEdit={canEdit}
                  onChanged={(f) => {
                    setFax(f);
                    router.refresh();
                  }}
                />
              ) : null}

              {canEdit && !fax.appointmentId && fax.run.status !== "running" ? (
                <Panel title="Move to a queue">
                  <div className="flex flex-wrap items-center gap-3">
                    <Select
                      aria-label="Queue"
                      value={fax.queue}
                      onChange={(e) => act("queue", () => postJson(`/api/faxes/${fax.id}/queue`, { queue: e.target.value as Queue }))}
                      className="max-w-[260px]"
                      disabled={Boolean(busy)}
                    >
                      {(["review", "needs_info", "ready", "other"] as Queue[]).map((q) => (
                        <option key={q} value={q}>
                          {QUEUE_LABELS[q]}
                        </option>
                      ))}
                    </Select>
                    <span className="text-[14px] text-graphite">The app picks a queue after every change; you can always move it.</span>
                  </div>
                </Panel>
              ) : null}

              <Panel title="History">
                <ul className="flex flex-col gap-2 text-[14px]">
                  {[...fax.history].reverse().map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-2">
                      <span className="text-graphite">{formatDate(h.at)}</span>
                      <span>{h.by}:</span>
                      <span>{h.text}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
          <ApiCallsPanel calls={fax.calls} />
        </div>
      </section>
    </div>
  );
}

function nameFirst(name: string): string {
  const n = name.includes(",") ? name.split(",")[1]?.trim() ?? name : name;
  const w = n.split(/\s+/)[0] ?? n;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function FieldRow({
  faxId, path, label, field, selected, onShow, canEdit, onSaved, compact = false,
}: {
  faxId: string; path: string; label: string; field: Field; selected: boolean; onShow: () => void; canEdit: boolean; onSaved: (f: Omit<Fax, "raw">) => void; compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const s = STATUS[field.status];

  async function save(body: Record<string, unknown>) {
    setError(null);
    try {
      const { fax } = await api<{ fax: Omit<Fax, "raw"> }>(`/api/faxes/${faxId}/fields`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, ...body }) });
      onSaved(fax);
      setEditing(false);
    } catch (err) {
      setError(asAppError(err).message);
    }
  }

  return (
    <div className={`flex flex-col gap-1 rounded-[12px] px-3 py-2 ${selected ? "bg-cream" : ""}`}>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "md:grid md:grid-cols-[150px_1fr_auto]"}`}>
        {!compact ? <span className="text-[14px] text-graphite">{label}</span> : null}
        {editing ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save({ value });
            }}
          >
            <Input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={path === "patient.dob" ? "YYYY-MM-DD" : path === "urgency" ? "routine, urgent or stat" : ""} />
            <Button type="submit" size="sm">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </form>
        ) : (
          <button type="button" onClick={onShow} className="min-w-0 flex-1 text-left text-[16px] break-words hover:underline hover:underline-offset-4 disabled:no-underline" disabled={!field.page}>
            {field.value ?? <span className="text-graphite">Not on the fax</span>}
          </button>
        )}
        {!editing ? (
          <span className="flex items-center gap-1">
            <Badge tone={s.tone}>{s.label}</Badge>
            {canEdit && field.status === "check" && field.value ? (
              <button type="button" aria-label={`Confirm ${label}`} title="Looks right" className="rounded-full p-1 hover:bg-cream" onClick={() => save({ confirm: true })}>
                <Check className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" aria-label={`Edit ${label}`} title="Edit" className="rounded-full p-1 hover:bg-cream" onClick={() => { setValue(field.value ?? ""); setEditing(true); }}>
                <Pencil className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {field.note && field.status === "check" ? <p className="text-[12px] text-graphite">{field.note}</p> : null}
      {field.original !== undefined && field.original !== field.value ? <p className="text-[12px] text-graphite">Read from the fax: {field.original ?? "(nothing)"}</p> : null}
      {error ? <p className="text-[12px]" role="alert">{error}</p> : null}
    </div>
  );
}

function PatientPanel({ fax, canEdit, busy, act }: { fax: Omit<Fax, "raw">; canEdit: boolean; busy: string | null; act: (k: string, fn: () => Promise<{ fax?: Omit<Fax, "raw"> } | void>) => void }) {
  const m = fax.match!;
  const title = m.status === "match" ? "Existing patient found" : m.status === "possible" ? "Possible existing patient" : m.status === "confirmed" ? "Patient confirmed" : m.status === "created" ? "New patient created" : "New patient";
  return (
    <Panel title={title}>
      {m.candidates.length ? (
        <div className="flex flex-col gap-2">
          {m.candidates.map((c) => (
            <div key={c.patientId} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-fog p-3">
              <div className="flex flex-1 flex-col">
                <span className="font-medium">{c.name}</span>
                <span className="text-[14px] text-graphite">
                  {c.mrn} · DOB {c.dob} · {c.why}
                </span>
              </div>
              {canEdit && (m.status === "possible" || m.status === "match") ? (
                <Button size="sm" variant={m.status === "match" ? "secondary" : "primary"} disabled={Boolean(busy)} onClick={() => act("confirm", () => postJson(`/api/faxes/${fax.id}/patient`, { action: "confirm", patientId: c.patientId }))}>
                  This is the patient
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[14px] text-graphite">No patient with this name and date of birth is on file.</p>
      )}
      {canEdit && (m.status === "new" || m.status === "possible") ? (
        <Button variant={m.status === "new" ? "primary" : "secondary"} className="self-start" disabled={Boolean(busy)} onClick={() => act("create", () => postJson(`/api/faxes/${fax.id}/patient`, { action: "create" }))}>
          Create a new patient
        </Button>
      ) : null}
    </Panel>
  );
}

function FaxBackPanel({ fax, canEdit, header, onSaved }: { fax: Omit<Fax, "raw">; canEdit: boolean; header: { header: string; closing: string } | null; onSaved: (fb: Fax["faxBack"]) => void }) {
  const [text, setText] = useState(fax.faxBack?.text ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = [header?.header, "", text, "", header?.closing].filter((x) => x !== undefined).join("\n");
  const source = fax.faxBack?.source;
  return (
    <Panel title="Request for missing items" actions={<CopyButton text={full} label="Copy fax" />}>
      <p className="text-[14px] text-graphite">
        {source === "template" ? "A fixed template (the drafted text did not pass the checks)." : source === "edited" ? "Edited by a coordinator." : "Drafted by Sully M1 and checked for promises, advice and medicines."} Edit it, then send it from your fax system. This app never sends faxes.
      </p>
      {header ? <pre className="rounded-[12px] bg-cream p-3 font-mono text-[12px] whitespace-pre-wrap">{header.header}</pre> : null}
      <Textarea aria-label="Request text" rows={9} value={text} onChange={(e) => setText(e.target.value)} readOnly={!canEdit} />
      {fax.faxBack?.issues?.length && source !== "edited" ? <p className="text-[12px] text-graphite">Draft fixed for: {fax.faxBack.issues.join(", ")}.</p> : null}
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              setError(null);
              try {
                const { faxBack } = await api<{ faxBack: Fax["faxBack"] }>(`/api/faxes/${fax.id}/fax-back`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
                onSaved(faxBack);
                setSaved(faxBack?.issues?.length ? `Saved. Heads up: it ${faxBack.issues.join(" and ")}.` : "Saved.");
              } catch (err) {
                setError(asAppError(err).message);
              }
            }}
          >
            Save edits
          </Button>
          {saved ? <span className="text-[12px] text-graphite">{saved}</span> : null}
          {error ? <span className="text-[12px]" role="alert">{error}</span> : null}
        </div>
      ) : null}
    </Panel>
  );
}

