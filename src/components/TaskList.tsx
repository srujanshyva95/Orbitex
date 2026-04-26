import { Check, Trash2 } from "lucide-react";
import { Task } from "@/types";
import { readableDate } from "@/lib/date";

export function TaskList({ tasks, onToggle, onDelete }: { tasks: Task[]; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  const badge = {
    High: "bg-rose-400/15 text-rose-200 border-rose-300/20",
    Medium: "bg-amber-400/15 text-amber-200 border-amber-300/20",
    Low: "bg-emerald-400/15 text-emerald-200 border-emerald-300/20",
  };

  return (
    <div className="space-y-3">
      {tasks.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">No tasks yet. Add your first task above.</div>
      ) : tasks.map((task) => (
        <div key={task.id} className="glass flex items-center gap-3 rounded-3xl p-4">
          <button onClick={() => onToggle(task.id)} className={`grid h-7 w-7 place-items-center rounded-full border ${task.done ? "border-cyan-300 bg-cyan-300 text-black" : "border-white/20"}`}>
            {task.done && <Check className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-medium ${task.done ? "text-slate-500 line-through" : "text-slate-100"}`}>{task.title}</p>
            <p className="mt-1 text-xs text-slate-500">Due {readableDate(task.dueDate)}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs ${badge[task.priority]}`}>{task.priority}</span>
          <button onClick={() => onDelete(task.id)} className="rounded-2xl p-2 text-slate-500 transition hover:bg-white/10 hover:text-rose-200">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
