import { Note } from "@/types";

export function QuickNotes({ notes }: { notes: Note[] }) {
  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-sm text-slate-500">No notes captured yet.</p>
      ) : notes.map((note) => (
        <div key={note.id} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-sm leading-6 text-slate-200">{note.text}</p>
          <p className="mt-2 text-xs text-slate-600">{note.createdAt}</p>
        </div>
      ))}
    </div>
  );
}
