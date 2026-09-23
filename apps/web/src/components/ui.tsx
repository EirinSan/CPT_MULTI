import type { Difficulty } from "@cpt/shared";
import type { ReactNode } from "react";

export function Panel({
  title,
  hint,
  children,
  className = "",
}: {
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-lab-border bg-lab-panel p-4 ${className}`}>
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
          {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-cyan-400 text-slate-950 hover:bg-cyan-300 disabled:bg-slate-700 disabled:text-slate-400",
    ghost: "border border-lab-border text-slate-200 hover:border-slate-500 disabled:text-slate-600",
    danger: "border border-rose-500/50 text-rose-300 hover:bg-rose-500/10",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

const DIFFICULTY: Record<Difficulty, [string, string]> = {
  EASY: ["Facile", "text-emerald-300 border-emerald-500/40"],
  MEDIUM: ["Moyen", "text-amber-300 border-amber-500/40"],
  HARD: ["Difficile", "text-rose-300 border-rose-500/40"],
  EXPERT: ["Expert", "text-fuchsia-300 border-fuchsia-500/40"],
};

export function DifficultyChip({ value }: { value: Difficulty }) {
  const [label, style] = DIFFICULTY[value];
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${style}`}>{label}</span>;
}

export const CATEGORY_LABEL: Record<string, string> = {
  SWITCHING: "Switching",
  ROUTING: "Routage",
  SECURITY: "Sécurité",
  SERVICES: "Services",
  TROUBLESHOOTING: "Dépannage",
};

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{children}</p>;
}
