import { CalendarDays, CheckSquare, LayoutDashboard, NotebookPen, Sparkles } from "lucide-react";

const items = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Tasks", icon: CheckSquare },
  { name: "Meetings", icon: CalendarDays },
  { name: "Notes", icon: NotebookPen },
];

export function Sidebar() {
  return (
    <aside className="glass hidden min-h-screen w-72 shrink-0 flex-col justify-between border-r border-white/10 p-6 lg:flex">
      <div>
        <div className="mb-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400/15 shadow-glow">
            <Sparkles className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Orbitex</h1>
            <p className="text-xs text-slate-400">Command your day</p>
          </div>
        </div>

        <nav className="space-y-2">
          {items.map((item, index) => (
            <a
              href={`#${item.name.toLowerCase()}`}
              key={item.name}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition hover:bg-white/10 ${
                index === 0 ? "bg-white/10 text-cyan-200" : "text-slate-300"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </a>
          ))}
        </nav>
      </div>

      <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/10 p-4">
        <p className="text-sm font-medium text-cyan-100">MVP Mode</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">Local data now. Cloud sync can come later.</p>
      </div>
    </aside>
  );
}
