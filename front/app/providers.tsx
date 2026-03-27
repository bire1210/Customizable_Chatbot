"use client";

import { ReactNode } from "react";
import { ToastProvider } from "./components/toast-provider";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
