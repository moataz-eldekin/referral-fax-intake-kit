/**
 * Tiny file store under app/data/ (gitignored). No database to install.
 *
 *   data/accounts.json            admin and coordinator logins (hashed passwords)
 *   data/faxes/<id>/fax.json      one fax: pages (OCR), referral fields, checks, queue, API calls
 *   data/faxes/<id>/page-<n>.png  the page images
 *   data/patients.json            existing patients (seeded from test-data/patients.json)
 *   data/appointments.json        booked visits
 *
 * Swap this one module for Postgres and object storage in production.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, TEST_DATA_DIR } from "./config";
import { hashPassword } from "./password";
import type { Appointment, Fax, FaxSummary, Patient, StoredAccount, User } from "./types";

const FAXES_DIR = path.join(DATA_DIR, "faxes");
const SAFE_ID = /^[a-zA-Z0-9-]{1,64}$/;

// One write lock shared by every route in this Node process, so parallel
// requests never overwrite each other's changes.
const globalLock = globalThis as unknown as { __storeLock?: Promise<unknown> };
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalLock.__storeLock ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalLock.__storeLock = next.catch(() => undefined);
  return next;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

// ---------- Accounts ----------

const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const DEFAULT_PASSWORD = "change-me";

/** First run: one admin (from ADMIN_EMAIL / ADMIN_PASSWORD) and one demo coordinator. */
function seedAccounts(): StoredAccount[] {
  const now = new Date().toISOString();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase() || "admin@example.com";
  const adminPassword = (process.env.ADMIN_PASSWORD ?? "").trim() || DEFAULT_PASSWORD;
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.warn(`[auth] ADMIN_EMAIL or ADMIN_PASSWORD is not set. Created admin ${adminEmail} with the default password. Change it.`);
  }
  console.warn("[auth] Created demo coordinator sam.ortiz@example.com with password change-me. Change or delete it in /admin.");
  return [
    { id: randomUUID(), role: "admin", email: adminEmail, name: "Admin", createdAt: now, passwordHash: hashPassword(adminPassword) },
    { id: randomUUID(), role: "coordinator", email: "sam.ortiz@example.com", name: "Sam Ortiz", createdAt: now, passwordHash: hashPassword(DEFAULT_PASSWORD) },
  ];
}

async function readAccounts(): Promise<StoredAccount[]> {
  const existing = await readJson<StoredAccount[]>(ACCOUNTS_FILE);
  if (existing) return existing;
  return withLock(async () => {
    const again = await readJson<StoredAccount[]>(ACCOUNTS_FILE);
    if (again) return again;
    const seeded = seedAccounts();
    await writeJson(ACCOUNTS_FILE, seeded);
    return seeded;
  });
}

function toUser({ passwordHash: _hash, ...user }: StoredAccount): User {
  void _hash;
  return user;
}

export async function findAccountByEmail(email: string): Promise<StoredAccount | undefined> {
  const e = email.trim().toLowerCase();
  return (await readAccounts()).find((a) => a.email === e);
}

export async function getUser(id: string): Promise<User | undefined> {
  const account = (await readAccounts()).find((a) => a.id === id);
  return account ? toUser(account) : undefined;
}

export async function listStaff(): Promise<User[]> {
  return (await readAccounts()).filter((a) => a.role === "coordinator").map(toUser);
}

export type StaffInput = { name: string; email: string };

export async function createStaff(input: StaffInput, password: string): Promise<User | { error: string }> {
  await readAccounts();
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    if (accounts.some((a) => a.email === input.email)) return { error: "An account with that email already exists." };
    const account: StoredAccount = { ...input, id: randomUUID(), role: "coordinator", createdAt: new Date().toISOString(), passwordHash: hashPassword(password) };
    await writeJson(ACCOUNTS_FILE, [...accounts, account]);
    return toUser(account);
  });
}

export async function updateStaff(id: string, input: StaffInput): Promise<User | { error: string } | undefined> {
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    const index = accounts.findIndex((a) => a.id === id && a.role === "coordinator");
    if (index === -1) return undefined;
    if (accounts.some((a) => a.email === input.email && a.id !== id)) return { error: "An account with that email already exists." };
    accounts[index] = { ...accounts[index], ...input };
    await writeJson(ACCOUNTS_FILE, accounts);
    return toUser(accounts[index]);
  });
}

export async function setPassword(id: string, password: string): Promise<boolean> {
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    const account = accounts.find((a) => a.id === id);
    if (!account) return false;
    account.passwordHash = hashPassword(password);
    await writeJson(ACCOUNTS_FILE, accounts);
    return true;
  });
}

export async function deleteStaff(id: string): Promise<boolean> {
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    const remaining = accounts.filter((a) => !(a.id === id && a.role === "coordinator"));
    if (remaining.length === accounts.length) return false;
    await writeJson(ACCOUNTS_FILE, remaining);
    return true;
  });
}

// ---------- Faxes ----------

function faxDir(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Invalid fax id");
  return path.join(FAXES_DIR, id);
}

export function pageImagePath(id: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error("Invalid page number");
  return path.join(faxDir(id), `page-${n}.png`);
}

export async function savePageImage(id: string, n: number, png: Buffer): Promise<void> {
  const file = pageImagePath(id, n);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, png);
}

export async function readPageImage(id: string, n: number): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(pageImagePath(id, n));
  } catch {
    return undefined;
  }
}

export async function getFax(id: string): Promise<Fax | undefined> {
  if (!SAFE_ID.test(id)) return undefined;
  return readJson<Fax>(path.join(faxDir(id), "fax.json"));
}

export async function saveFax(fax: Fax): Promise<void> {
  await withLock(() => writeJson(path.join(faxDir(fax.id), "fax.json"), fax));
}

/** Read-modify-write under the lock. Returns the updated fax. */
export async function updateFax(id: string, change: (fax: Fax) => Fax | void): Promise<Fax> {
  return withLock(async () => {
    const file = path.join(faxDir(id), "fax.json");
    const fax = await readJson<Fax>(file);
    if (!fax) throw new Error("Fax not found");
    const next = change(fax) ?? fax;
    next.updatedAt = new Date().toISOString();
    await writeJson(file, next);
    return next;
  });
}

export async function listFaxes(): Promise<Fax[]> {
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(FAXES_DIR);
  } catch {
    return [];
  }
  const faxes = await Promise.all(dirs.filter((d) => SAFE_ID.test(d)).map((d) => readJson<Fax>(path.join(FAXES_DIR, d, "fax.json"))));
  return faxes.filter((f): f is Fax => Boolean(f)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteFax(id: string): Promise<void> {
  await withLock(() => fs.rm(faxDir(id), { recursive: true, force: true }));
}

export function summarize(fax: Fax): FaxSummary {
  const r = fax.referral;
  return {
    id: fax.id,
    createdAt: fax.createdAt,
    source: fax.source,
    fileName: fax.fileName,
    fromFax: fax.fromFax,
    pageCount: fax.pageCount,
    kind: fax.kind,
    queue: fax.queue,
    urgency: fax.urgency,
    run: fax.run,
    appointmentId: fax.appointmentId,
    duplicateOf: fax.duplicateOf,
    patientName: r?.patient.name.value ?? null,
    specialty: r?.specialty.value ?? null,
    referringPractice: r?.referring.practice.value ?? r?.referring.name.value ?? null,
    toCheck: fax.checks.filter((c) => c.level === "check").length,
    missing: fax.checks.filter((c) => c.level === "missing").length,
  };
}

// ---------- Patients ----------

const PATIENTS_FILE = path.join(DATA_DIR, "patients.json");

export async function listPatients(): Promise<Patient[]> {
  const existing = await readJson<Patient[]>(PATIENTS_FILE);
  if (existing) return existing;
  return withLock(async () => {
    const again = await readJson<Patient[]>(PATIENTS_FILE);
    if (again) return again;
    const seed = (await readJson<Array<Omit<Patient, "id" | "createdAt">>>(path.join(TEST_DATA_DIR, "patients.json"))) ?? [];
    const now = new Date().toISOString();
    const patients = seed.map((p) => ({ ...p, id: randomUUID(), createdAt: now }));
    await writeJson(PATIENTS_FILE, patients);
    return patients;
  });
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  return (await listPatients()).find((p) => p.id === id);
}

export async function createPatient(input: { name: string; dob: string; phone?: string; fromFaxId?: string }): Promise<Patient> {
  await listPatients();
  return withLock(async () => {
    const patients = (await readJson<Patient[]>(PATIENTS_FILE)) ?? [];
    const mrn = `LV${String(100000 + patients.length + 1)}`;
    const patient: Patient = { id: randomUUID(), mrn, createdAt: new Date().toISOString(), ...input };
    await writeJson(PATIENTS_FILE, [...patients, patient]);
    return patient;
  });
}

// ---------- Appointments ----------

const APPOINTMENTS_FILE = path.join(DATA_DIR, "appointments.json");

export async function listAppointments(): Promise<Appointment[]> {
  return (await readJson<Appointment[]>(APPOINTMENTS_FILE)) ?? [];
}

/** Books a slot unless someone else took it first. */
export async function addAppointment(appt: Appointment): Promise<Appointment | { error: string }> {
  return withLock(async () => {
    const all = (await readJson<Appointment[]>(APPOINTMENTS_FILE)) ?? [];
    if (all.some((a) => a.slotId === appt.slotId)) return { error: "Someone just booked that slot. Pick another one." };
    await writeJson(APPOINTMENTS_FILE, [...all, appt]);
    return appt;
  });
}

export async function removeAppointment(id: string): Promise<Appointment | undefined> {
  return withLock(async () => {
    const all = (await readJson<Appointment[]>(APPOINTMENTS_FILE)) ?? [];
    const found = all.find((a) => a.id === id);
    if (!found) return undefined;
    await writeJson(APPOINTMENTS_FILE, all.filter((a) => a.id !== id));
    return found;
  });
}
