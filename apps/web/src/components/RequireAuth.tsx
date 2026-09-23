import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../store/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
