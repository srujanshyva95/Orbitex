export function todayISO() {
  return new Date().toISOString().split("T")[0];
}

export function tomorrowISO() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().split("T")[0];
}

export function readableDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}
