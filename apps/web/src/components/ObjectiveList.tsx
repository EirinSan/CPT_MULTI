import type { MissionObjective } from "@cpt/shared";

export function ObjectiveList({ objectives, results }: { objectives: MissionObjective[]; results: boolean[] | null }) {
  return (
    <ul className="space-y-1.5">
      {objectives.map((o, i) => {
        const passed = results?.[i] ?? false;
        return (
          <li key={o.label} className="flex items-start gap-2 text-sm">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                passed ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-600 text-transparent"
              }`}
              aria-label={passed ? "validé" : "à faire"}
            >
              ✓
            </span>
            <span className={passed ? "text-slate-400 line-through decoration-slate-600" : "text-slate-200"}>{o.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
