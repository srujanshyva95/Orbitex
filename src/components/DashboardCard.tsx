import { LucideIcon } from "lucide-react";

export function DashboardCard({ title, value, hint, icon: Icon }: { title: string; value: string; hint: string; icon: LucideIcon }) {
  return (
    <div className="glass rounded-3xl p-5 shadow-glow">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">{title}</p>
        <div className="rounded-2xl bg-white/10 p-2 text-cyan-200">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
