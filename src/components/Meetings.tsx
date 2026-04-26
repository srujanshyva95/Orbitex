import { Meeting } from "@/types";
import { readableDate } from "@/lib/date";

export function Meetings({ meetings }: { meetings: Meeting[] }) {
  return (
    <div className="space-y-3">
      {meetings.map((meeting) => (
        <div key={meeting.id} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-sm font-medium text-slate-100">{meeting.title}</p>
          <p className="mt-1 text-xs text-slate-500">{readableDate(meeting.date)} · {meeting.time}</p>
        </div>
      ))}
    </div>
  );
}
