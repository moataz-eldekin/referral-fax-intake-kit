import type { ReactNode } from "react";

export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 rounded-[16px] border border-fog bg-paper p-6 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[24px] font-medium tracking-[-0.02em]">{title}</h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
