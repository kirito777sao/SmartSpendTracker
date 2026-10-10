import { createContext, useContext, useState, type ReactNode } from "react";

// CONSTITUTION §1.1: scopeMode là lựa chọn UI (personal/household), không phải
// server state -> giữ ở Context thay vì prop-drill qua App.tsx. Mọi hook data
// (T-S06b) đọc scopeMode từ đây để dựng query key, không nhận qua tham số tay.
export type ScopeMode = "personal" | "household";

interface ScopeContextValue {
  scopeMode: ScopeMode;
  setScopeMode: (mode: ScopeMode) => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  // Giữ nguyên default "personal" như App.tsx gốc (dòng 219 bản trước T-S06a).
  const [scopeMode, setScopeMode] = useState<ScopeMode>("personal");

  return (
    <ScopeContext.Provider value={{ scopeMode, setScopeMode }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error("useScope() phải được gọi bên trong <ScopeProvider>");
  }
  return ctx;
}
