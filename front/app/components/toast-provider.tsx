"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

type ToastKind = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: string;
  message: string;
  kind: ToastKind;
  durationMs: number;
};

type ToastApi = {
  show: (message: string, kind?: ToastKind, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
  warning: (message: string, durationMs?: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info", durationMs = 3500) => {
      const id = crypto.randomUUID();
      const toast: ToastItem = {
        id,
        message,
        kind,
        durationMs,
      };

      setToasts((current) => [...current, toast]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, durationMs) => show(message, "success", durationMs),
      error: (message, durationMs) => show(message, "error", durationMs),
      info: (message, durationMs) => show(message, "info", durationMs),
      warning: (message, durationMs) => show(message, "warning", durationMs),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <p>{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              x
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
