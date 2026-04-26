export type Priority = "High" | "Medium" | "Low";

export type Task = {
  id: string;
  title: string;
  priority: Priority;
  dueDate: string;
  done: boolean;
};

export type Meeting = {
  id: string;
  title: string;
  time: string;
  date: string;
};

export type Note = {
  id: string;
  text: string;
  createdAt: string;
};
