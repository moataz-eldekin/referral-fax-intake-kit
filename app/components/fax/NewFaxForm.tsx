"use client";

import { FileUp, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Field, Input } from "@/components/ui/Field";
import { api, asAppError, postJson } from "@/lib/client";
import type { SampleManifest } from "@/lib/samples";
import type { AppError, FaxSummary } from "@/lib/types";

const MAX = 10 * 1024 * 1024;

export function NewFaxForm({ samples }: { samples: SampleManifest[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [fromFax, setFromFax] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!files.length) return setError({ title: "No file", message: "Choose a fax file first." });
    if (files.reduce((n, f) => n + f.size, 0) > MAX) return setError({ title: "File too large", message: "Faxes can be at most 10 MB." });
    const form = new FormData();
    for (const f of files) form.append("file", f);
    if (fromFax.trim()) form.append("fromFax", fromFax.trim());
    setBusy("upload");
    try {
      const { fax } = await api<{ fax: FaxSummary }>("/api/faxes", { method: "POST", body: form });
      router.push(`/faxes/${fax.id}`);
    } catch (err) {
      setError(asAppError(err));
      setBusy(null);
    }
  }

  async function loadSample(slug: string) {
    setError(null);
    setBusy(slug);
    try {
      const { fax } = await postJson<{ fax: FaxSummary }>("/api/faxes", { sample: slug });
      router.push(`/faxes/${fax.id}`);
    } catch (err) {
      setError(asAppError(err));
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
      <form onSubmit={upload} className="flex h-fit flex-col gap-5 rounded-[16px] border border-fog bg-paper p-6 md:p-8">
        <h2 className="flex items-center gap-2 text-[20px] font-medium">
          <FileUp aria-hidden className="h-5 w-5" strokeWidth={1.5} /> Upload a fax
        </h2>
        <Field label="Fax file" htmlFor="file" hint="One PDF or TIFF, or PNG/JPG pages in order. Up to 10 MB and 20 pages. Synthetic or de-identified faxes only until you have a BAA in place.">
          <Input id="file" type="file" accept=".pdf,.tif,.tiff,.png,.jpg,.jpeg" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </Field>
        <Field label="From fax number (optional)" htmlFor="from">
          <Input id="from" value={fromFax} onChange={(e) => setFromFax(e.target.value)} placeholder="(555) 201-4400" />
        </Field>
        {error ? <ErrorNotice error={error} /> : null}
        <Button type="submit" disabled={Boolean(busy)}>
          {busy === "upload" ? "Uploading..." : "Read this fax"}
        </Button>
        <p className="text-[12px] text-graphite">Faxes can also arrive from your fax service at POST /api/inbound-fax (see the README).</p>
      </form>
      <div className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-[20px] font-medium">
          <Printer aria-hidden className="h-5 w-5" strokeWidth={1.5} /> Or try a sample fax
        </h2>
        <p className="text-[14px] text-graphite">Fictional patients. Each one hides something the app should catch.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {samples.map((s) => (
            <div key={s.slug} className="flex flex-col gap-3 rounded-[16px] border border-fog bg-paper p-5">
              <span className="font-medium">{s.title}</span>
              <span className="flex-1 text-[14px] text-graphite">{s.blurb}</span>
              <Button variant="secondary" size="sm" className="self-start" disabled={Boolean(busy)} onClick={() => loadSample(s.slug)}>
                {busy === s.slug ? "Loading..." : "Load fax"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
