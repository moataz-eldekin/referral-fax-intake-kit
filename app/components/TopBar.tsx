import Link from "next/link";
import { Inbox } from "lucide-react";
import type { User } from "@/lib/types";
import { buttonClass } from "./ui/Button";
import { DemoBadge } from "./ui/Badge";

export function TopBar({ demo, user }: { demo: boolean; user: User | null }) {
  return (
    <header className="bg-paper">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-[18px] font-medium tracking-[-0.02em]">
            <Inbox aria-hidden className="h-5 w-5" strokeWidth={1.5} />
            Referral Intake
          </Link>
          {demo ? <DemoBadge /> : null}
        </div>
        {user ? (
          <nav aria-label="Main" className="flex flex-wrap items-center gap-6 md:gap-8">
            <Link href="/" className="text-[16px] underline-offset-4 hover:underline">
              Queue
            </Link>
            <Link href="/schedule" className="text-[16px] underline-offset-4 hover:underline">
              Booked visits
            </Link>
            <Link href="/patients" className="text-[16px] underline-offset-4 hover:underline">
              Patients
            </Link>
            {user.role === "admin" ? (
              <Link href="/admin" className="text-[16px] underline-offset-4 hover:underline">
                Staff
              </Link>
            ) : null}
            <span className="text-[14px] text-graphite">{user.role === "admin" ? "Admin (read only)" : `${user.name} · Intake`}</span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-[14px] underline-offset-4 hover:underline">
                Log out
              </button>
            </form>
            {user.role === "coordinator" ? (
              <Link href="/faxes/new" className={buttonClass("primary", "sm")}>
                Add fax
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
