"use client";

import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Accessible native <dialog> top-layer modal following modern web standards:
 * avoids aria-modal/role overrides or manual body overflow locks.
 */
export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="sc-modal"
    >
      <div className="border-b border-border-subtle bg-mint-soft/70 px-6 py-4 flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-lg font-bold text-forest">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded-lg p-1.5 text-ink-muted hover:bg-mint hover:text-forest transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="p-6 max-h-[78vh] overflow-y-auto">{children}</div>
    </dialog>
  );
}

