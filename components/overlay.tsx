"use client";

import { X } from "lucide-react";

export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="panel-shadow relative max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--border)] bg-white">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border)] bg-white px-5 py-4">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
            {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--ink)]"
            aria-label="Close dialog"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/35"
        onClick={onClose}
        aria-label="Close detail panel"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--border)] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div>
            <h2 id="drawer-title" className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
            {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--ink)]"
            aria-label="Close detail panel"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
