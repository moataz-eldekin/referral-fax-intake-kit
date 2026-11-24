"use client";

import { KeyRound, Trash2, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Field, Input } from "@/components/ui/Field";
import { api, asAppError, postJson } from "@/lib/client";
import type { AppError, User } from "@/lib/types";

/** The admin's list of intake coordinators: add, reset password, remove. */
export function StaffManager({ initialStaff }: { initialStaff: User[] }) {
  const [staff, setStaff] = useState(initialStaff);
  const [draft, setDraft] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { staff: s } = await postJson<{ staff: User }>("/api/staff", draft);
      setStaff((x) => [...x, s]);
      setDraft({ name: "", email: "", password: "" });
      setNotice(`Added ${s.name}.`);
    } catch (err) {
      setError(asAppError(err));
    }
  }

  async function reset(u: User) {
    const password = window.prompt(`New password for ${u.name} (at least 8 characters)`);
    if (!password) return;
    try {
      await postJson(`/api/staff/${u.id}/password`, { password });
      setNotice(`Password changed for ${u.name}.`);
    } catch (err) {
      setError(asAppError(err));
    }
  }

  async function remove(u: User) {
    if (!window.confirm(`Remove ${u.name}'s login? Their faxes and history stay.`)) return;
    try {
      await api(`/api/staff/${u.id}`, { method: "DELETE" });
      setStaff((x) => x.filter((s) => s.id !== u.id));
    } catch (err) {
      setError(asAppError(err));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-3">
        {staff.length === 0 ? <p className="text-graphite">No coordinators yet.</p> : null}
        {staff.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-4 rounded-[16px] border border-fog bg-paper p-5">
            <UserRound aria-hidden className="h-5 w-5" strokeWidth={1.5} />
            <div className="flex flex-1 flex-col">
              <span className="font-medium">{u.name}</span>
              <span className="text-[14px] text-graphite">{u.email}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => reset(u)}>
              <KeyRound aria-hidden className="h-4 w-4" strokeWidth={1.5} /> Reset password
            </Button>
            <Button variant="secondary" size="sm" onClick={() => remove(u)}>
              <Trash2 aria-hidden className="h-4 w-4" strokeWidth={1.5} /> Remove
            </Button>
          </div>
        ))}
        {notice ? <p className="text-[14px] text-graphite">{notice}</p> : null}
        {error ? <ErrorNotice error={error} /> : null}
      </div>
      <form onSubmit={add} className="flex flex-col gap-4 rounded-[16px] border border-fog bg-paper p-6">
        <h2 className="text-[18px] font-medium">Add a coordinator</h2>
        <Field label="Name" htmlFor="s-name">
          <Input id="s-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </Field>
        <Field label="Email" htmlFor="s-email">
          <Input id="s-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
        </Field>
        <Field label="Password" htmlFor="s-pass" hint="At least 8 characters.">
          <Input id="s-pass" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} required minLength={8} />
        </Field>
        <Button type="submit">Add coordinator</Button>
      </form>
    </div>
  );
}
