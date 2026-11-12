"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastTone = "success" | "warning" | "error" | "info";

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setItems((prev) => [...prev.slice(-3), { ...toast, id }]);
      setTimeout(() => {
        dismiss(id);
      }, 4500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-20 right-4 left-4 sm:left-auto sm:bottom-5 z-50 flex flex-col gap-2 sm:w-96"
      >
        {items.map((item) => {
          const styles: Record<ToastTone, string> = {
            success: "border-emerald/30 bg-white text-forest",
            warning: "border-amber-300 bg-white text-amber-safe",
            error: "border-red-300 bg-white text-danger",
            info: "border-border-subtle bg-white text-forest",
          };
          const Icon =
            item.tone === "success"
              ? CheckCircle2
              : item.tone === "info"
              ? Info
              : AlertCircle;

          return (
            <div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-3.5 shadow-lg ${styles[item.tone]}`}
            >
              <Icon className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">{item.title}</div>
                {item.message ? (
                  <p className="mt-0.5 text-xs text-ink-muted leading-snug">
                    {item.message}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(item.id)}
                className="rounded-lg p-1 text-ink-muted hover:bg-surface-muted hover:text-forest cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

