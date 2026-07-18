import { createContext, useContext } from "react";

export const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function errMsg(err, fallback = "Something went wrong") {
  return err?.response?.data?.detail || err?.message || fallback;
}
