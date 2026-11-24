import { TopBar } from "@/components/TopBar";
import { getCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/config";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <TopBar demo={isDemoMode()} user={user} />
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="mx-auto w-full max-w-[1200px] px-6 py-10 text-[14px] text-graphite">
        Built on Sully Text to JSON and Sully M1. Fields are drafts read from the fax. Check each one against the page before you book.
      </footer>
    </>
  );
}
