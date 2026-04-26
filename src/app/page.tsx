"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Download,
  Edit3,
  Flame,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  NotebookPen,
  RotateCcw,
  Search,
  ShieldCheck,
  Timer,
  Trophy,
  Trash2,
  User,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User as FirebaseUser,
  type UserCredential,
} from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { auth, authPersistenceReady, db, firebaseReady, googleProvider } from "@/lib/firebase";

type View = "Dashboard" | "Routine" | "Focus Mode" | "Tasks" | "Meetings" | "Notes" | "Groups" | "Profile";
type Priority = "High" | "Medium" | "Low";
type TaskFilter = "All" | "Active" | "Completed";

type Task = {
  id: string;
  title: string;
  priority: Priority;
  due: string;
  done: boolean;
  carriedOver?: boolean;
  completedAt?: number;
  createdAt: number;
};

type Meeting = {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  type: string;
  createdAt: number;
};

type GroupMember = {
  id: string;
  name: string;
  email: string;
  role: "creator" | "member";
};

type Group = {
  id: string;
  name: string;
  inviteCode: string;
  creatorId: string;
  members: string[];
  memberProfiles: GroupMember[];
  leaderboard: GroupLeaderboardEntry[];
  createdAt: number;
};

type GroupTask = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  createdBy: string;
  createdByName: string;
  completedBy?: string;
  completedByName?: string;
  completedAt?: number;
};

type StudyDuration = 25 | 50 | 90;

type StudySession = {
  title: string;
  durationMinutes: StudyDuration;
  startedAt: number;
  endsAt: number;
  startedBy: string;
  startedByName: string;
  participantIds: string[];
  participantNames: string[];
  statsRecordedAt?: number;
};

type DailyStats = {
  date: string;
  appOpened: boolean;
  studySessionsCompleted: number;
  focusMinutes: number;
  tasksCompleted: number;
  routineCompletedBlocks: string[];
  routineCompletionPercent: number;
  successfulDay: boolean;
  currentStreak: number;
  bestStreak: number;
  recordedStudySessionIds: string[];
  updatedAt: number;
};

type GroupLeaderboardEntry = {
  id: string;
  name: string;
  weekKey: string;
  focusMinutes: number;
  completedGroupTasks: number;
};

type RoutineBlock = {
  id: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  defaultDuration: StudyDuration;
};

type AppUser = Pick<FirebaseUser, "uid" | "displayName" | "email">;

const today = new Date().toISOString().slice(0, 10);
const noteDocumentId = "brain-dump";
const TEMP_AUTH_BYPASS = false;
const previewUser: AppUser = {
  uid: "orbitex-preview-user",
  displayName: "Srujan",
  email: "preview@orbitex.local",
};
const previewStorageKeys = {
  tasks: "orbitex-preview-tasks",
  meetings: "orbitex-preview-meetings",
  groups: "orbitex-preview-groups",
  groupTasks: "orbitex-preview-group-tasks",
  groupSessions: "orbitex-preview-group-sessions",
  dailyStats: "orbitex-preview-daily-stats",
  routines: "orbitex-preview-routines",
  note: "orbitex-preview-note",
};

const navItems: Array<[View, LucideIcon]> = [
  ["Dashboard", LayoutDashboard],
  ["Routine", ListChecks],
  ["Focus Mode", Timer],
  ["Tasks", CheckCircle2],
  ["Meetings", CalendarDays],
  ["Notes", NotebookPen],
  ["Groups", UsersRound],
  ["Profile", User],
];

const defaultRoutineBlocks: RoutineBlock[] = [
  { id: "morning-deep-study", title: "Morning Deep Study", startMinutes: 6 * 60, endMinutes: 7 * 60 + 30, defaultDuration: 50 },
  { id: "core-focus-block", title: "Core Focus Block", startMinutes: 9 * 60, endMinutes: 11 * 60, defaultDuration: 50 },
  { id: "afternoon-review", title: "Afternoon Review", startMinutes: 14 * 60, endMinutes: 15 * 60, defaultDuration: 25 },
  { id: "evening-revision", title: "Evening Revision", startMinutes: 20 * 60, endMinutes: 21 * 60 + 30, defaultDuration: 50 },
];

const priorityRank: Record<Priority, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};

const priorityBadgeClass: Record<Priority, string> = {
  High: "bg-red-400/15 text-red-200",
  Medium: "bg-purple-400/15 text-purple-200",
  Low: "bg-cyan-400/15 text-cyan-200",
};

function normalizeDueDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
}

function normalizeMeetingDuration(value: string | number | undefined) {
  const duration = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(duration) || duration <= 0) return 30;
  return Math.min(duration, 480);
}

function isPriority(value: unknown): value is Priority {
  return value === "High" || value === "Medium" || value === "Low";
}

function isOverdue(task: Task) {
  return !task.done && task.due < today;
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((firstTask, secondTask) => {
    if (firstTask.done !== secondTask.done) return firstTask.done ? 1 : -1;

    const priorityDifference = priorityRank[firstTask.priority] - priorityRank[secondTask.priority];
    if (priorityDifference !== 0) return priorityDifference;

    if (firstTask.due !== secondTask.due) return firstTask.due.localeCompare(secondTask.due);
    return secondTask.createdAt - firstTask.createdAt;
  });
}

function sortMeetings(meetings: Meeting[]) {
  return [...meetings].sort((firstMeeting, secondMeeting) => {
    if (firstMeeting.date !== secondMeeting.date) return firstMeeting.date.localeCompare(secondMeeting.date);
    return (parseMeetingStart(firstMeeting.time) ?? 0) - (parseMeetingStart(secondMeeting.time) ?? 0);
  });
}

function sortRoutines(routines: RoutineBlock[]) {
  return [...routines].sort((firstRoutine, secondRoutine) => {
    if (firstRoutine.startMinutes !== secondRoutine.startMinutes) return firstRoutine.startMinutes - secondRoutine.startMinutes;
    return firstRoutine.title.localeCompare(secondRoutine.title);
  });
}

function parseTask(id: string, data: DocumentData): Task | null {
  if (typeof data.title !== "string" || typeof data.due !== "string" || typeof data.done !== "boolean" || !isPriority(data.priority)) {
    return null;
  }

  return {
    id,
    title: data.title,
    priority: data.priority,
    due: normalizeDueDate(data.due),
    done: data.done,
    carriedOver: Boolean(data.carriedOver),
    completedAt: typeof data.completedAt === "number" ? data.completedAt : undefined,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
  };
}

function parseMeeting(id: string, data: DocumentData): Meeting | null {
  if (typeof data.title !== "string" || typeof data.date !== "string" || typeof data.time !== "string" || typeof data.type !== "string") {
    return null;
  }

  return {
    id,
    title: data.title,
    date: normalizeDueDate(data.date),
    time: data.time,
    duration: normalizeMeetingDuration(typeof data.duration === "number" ? data.duration : undefined),
    type: data.type,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
  };
}

function normalizeStudyDuration(value: unknown): StudyDuration {
  return value === 90 ? 90 : value === 50 ? 50 : 25;
}

function parseRoutine(id: string, data: DocumentData): RoutineBlock | null {
  if (
    typeof data.title !== "string" ||
    typeof data.startMinutes !== "number" ||
    typeof data.endMinutes !== "number"
  ) {
    return null;
  }

  return {
    id,
    title: data.title,
    startMinutes: Math.max(0, Math.min(1439, data.startMinutes)),
    endMinutes: Math.max(1, Math.min(1440, data.endMinutes)),
    defaultDuration: normalizeStudyDuration(data.defaultDuration),
  };
}

function parseGroup(id: string, data: DocumentData): Group | null {
  if (
    typeof data.name !== "string" ||
    typeof data.inviteCode !== "string" ||
    typeof data.creatorId !== "string"
  ) {
    return null;
  }

  const rawMembers = Array.isArray(data.members) ? data.members : [];
  const rawMemberProfiles = Array.isArray(data.memberProfiles) ? data.memberProfiles : rawMembers;
  const members = rawMembers
    .map((member: unknown) => {
      if (typeof member === "string") return member;
      if (member && typeof member === "object" && typeof (member as Record<string, unknown>).id === "string") {
        return (member as Record<string, string>).id;
      }
      return null;
    })
    .filter((member): member is string => Boolean(member));

  const memberProfiles = rawMemberProfiles
    .map((member: unknown): GroupMember | null => {
      if (!member || typeof member !== "object") return null;
      const candidate = member as Record<string, unknown>;
      const role = candidate.role === "member" ? "member" : "creator";

      if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.email !== "string") {
        return null;
      }

      return {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        role,
      };
    })
    .filter((member): member is GroupMember => Boolean(member));

  if (members.length === 0) {
    memberProfiles.forEach((member) => members.push(member.id));
  }

  return {
    id,
    name: data.name,
    inviteCode: data.inviteCode,
    creatorId: data.creatorId,
    members,
    memberProfiles,
    leaderboard: parseLeaderboard(data.leaderboard, memberProfiles),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
  };
}

function parseLeaderboard(value: unknown, members: GroupMember[]) {
  const rawEntries = Array.isArray(value) ? value : [];
  const parsedEntries = rawEntries
    .map((entry: unknown): GroupLeaderboardEntry | null => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;

      if (typeof candidate.id !== "string") return null;

      return {
        id: candidate.id,
        name: typeof candidate.name === "string" ? candidate.name : members.find((member) => member.id === candidate.id)?.name ?? "Orbitex user",
        weekKey: typeof candidate.weekKey === "string" ? candidate.weekKey : weekKey(),
        focusMinutes: typeof candidate.focusMinutes === "number" ? candidate.focusMinutes : 0,
        completedGroupTasks: typeof candidate.completedGroupTasks === "number" ? candidate.completedGroupTasks : 0,
      };
    })
    .filter((entry): entry is GroupLeaderboardEntry => Boolean(entry));

  members.forEach((member) => {
    if (!parsedEntries.some((entry) => entry.id === member.id)) {
      parsedEntries.push({
        id: member.id,
        name: member.name,
        weekKey: weekKey(),
        focusMinutes: 0,
        completedGroupTasks: 0,
      });
    }
  });

  return parsedEntries;
}

function parseGroupTask(id: string, data: DocumentData): GroupTask | null {
  if (
    typeof data.title !== "string" ||
    typeof data.done !== "boolean" ||
    typeof data.createdBy !== "string" ||
    typeof data.createdByName !== "string"
  ) {
    return null;
  }

  return {
    id,
    title: data.title,
    done: data.done,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    createdBy: data.createdBy,
    createdByName: data.createdByName,
    completedBy: typeof data.completedBy === "string" ? data.completedBy : undefined,
    completedByName: typeof data.completedByName === "string" ? data.completedByName : undefined,
    completedAt: typeof data.completedAt === "number" ? data.completedAt : undefined,
  };
}

function parseStudySession(data: DocumentData): StudySession | null {
  if (
    typeof data.startedAt !== "number" ||
    typeof data.endsAt !== "number" ||
    typeof data.startedBy !== "string" ||
    typeof data.startedByName !== "string" ||
    !Array.isArray(data.participantIds) ||
    !Array.isArray(data.participantNames)
  ) {
    return null;
  }

  const durationMinutes = data.durationMinutes === 90 ? 90 : data.durationMinutes === 50 ? 50 : 25;

  return {
    title: typeof data.title === "string" ? data.title : "Study Session",
    durationMinutes,
    startedAt: data.startedAt,
    endsAt: data.endsAt,
    startedBy: data.startedBy,
    startedByName: data.startedByName,
    participantIds: data.participantIds.filter((participant: unknown): participant is string => typeof participant === "string"),
    participantNames: data.participantNames.filter((participant: unknown): participant is string => typeof participant === "string"),
    statsRecordedAt: typeof data.statsRecordedAt === "number" ? data.statsRecordedAt : undefined,
  };
}

function generateInviteCode(existingCodes: string[]) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = `ORB-${Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`;
  } while (existingCodes.includes(code));

  return code;
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function userGroupProfile(user: AppUser, role: GroupMember["role"]): GroupMember {
  return {
    id: user.uid,
    name: user.displayName ?? "Orbitex user",
    email: user.email ?? "",
    role,
  };
}

function displayNameForUser(user: AppUser) {
  return user.displayName ?? user.email ?? "Orbitex user";
}

function sortGroupTasks(tasks: GroupTask[]) {
  return [...tasks].sort((firstTask, secondTask) => {
    if (firstTask.done !== secondTask.done) return firstTask.done ? 1 : -1;
    return secondTask.createdAt - firstTask.createdAt;
  });
}

function sessionRemainingSeconds(session: StudySession | null, now: number) {
  if (!session) return 0;
  return Math.max(0, Math.ceil((session.endsAt - now) / 1000));
}

function sessionProgress(session: StudySession | null, now: number) {
  if (!session) return 0;
  const totalMs = session.durationMinutes * 60 * 1000;
  const elapsedMs = Math.min(totalMs, Math.max(0, now - session.startedAt));
  return Math.round((elapsedMs / totalMs) * 100);
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatRoutineTime(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const clockMinutes = minutes % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${clockMinutes.toString().padStart(2, "0")} ${meridiem}`;
}

function formatTimeInput(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const clockMinutes = minutes % 60;
  return `${hours24.toString().padStart(2, "0")}:${clockMinutes.toString().padStart(2, "0")}`;
}

function parseTimeInput(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function routineStatus(now: number, routines: RoutineBlock[]) {
  if (now <= 0) {
    return {
      currentRoutine: null,
      nextRoutine: routines[0] ?? null,
    };
  }

  const currentTime = new Date(now);
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const sortedRoutines = sortRoutines(routines);
  const currentRoutine = sortedRoutines.find((routine) => currentMinutes >= routine.startMinutes && currentMinutes < routine.endMinutes) ?? null;
  const nextRoutine = sortedRoutines.find((routine) => routine.startMinutes > currentMinutes) ?? sortedRoutines[0] ?? null;

  return { currentRoutine, nextRoutine };
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function previousDateKey(date = new Date()) {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return dateKey(previous);
}

function weekKey(date = new Date()) {
  const start = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return dateKey(start);
}

function routineChecklistPercent(completedBlocks: string[], routines: RoutineBlock[]) {
  if (routines.length === 0) return 0;
  const completedCount = routines.filter((routine) => completedBlocks.includes(routine.id) || completedBlocks.includes(routine.title)).length;
  return Math.round((completedCount / routines.length) * 100);
}

function defaultDailyStats(date = today): DailyStats {
  return {
    date,
    appOpened: false,
    studySessionsCompleted: 0,
    focusMinutes: 0,
    tasksCompleted: 0,
    routineCompletedBlocks: [],
    routineCompletionPercent: 0,
    successfulDay: false,
    currentStreak: 0,
    bestStreak: 0,
    recordedStudySessionIds: [],
    updatedAt: Date.now(),
  };
}

function parseDailyStats(id: string, data: DocumentData): DailyStats {
  const routineCompletedBlocks = Array.isArray(data.routineCompletedBlocks)
    ? data.routineCompletedBlocks.filter((block: unknown): block is string => typeof block === "string")
    : [];
  const recordedStudySessionIds = Array.isArray(data.recordedStudySessionIds)
    ? data.recordedStudySessionIds.filter((sessionId: unknown): sessionId is string => typeof sessionId === "string")
    : [];
  const routineCompletion = typeof data.routineCompletionPercent === "number" ? data.routineCompletionPercent : 0;

  return {
    date: id,
    appOpened: Boolean(data.appOpened),
    studySessionsCompleted: typeof data.studySessionsCompleted === "number" ? data.studySessionsCompleted : 0,
    focusMinutes: typeof data.focusMinutes === "number" ? data.focusMinutes : 0,
    tasksCompleted: typeof data.tasksCompleted === "number" ? data.tasksCompleted : 0,
    routineCompletedBlocks,
    routineCompletionPercent: routineCompletion,
    successfulDay: typeof data.successfulDay === "boolean" ? data.successfulDay : routineCompletion >= 70,
    currentStreak: typeof data.currentStreak === "number" ? data.currentStreak : 0,
    bestStreak: typeof data.bestStreak === "number" ? data.bestStreak : 0,
    recordedStudySessionIds,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

function motivationalMessage(stats: DailyStats, yesterdayStats: DailyStats | null) {
  // Provide richer motivational feedback based on streak, routine completion, focus and tasks.
  // Long streaks with good routine completion deserve extra praise.
  if (stats.currentStreak >= 5 && stats.routineCompletionPercent >= 70) {
    return "You're on a hot streak! Don't stop now";
  }
  // Encourage keeping the streak alive when routine progress is high.
  if (stats.currentStreak > 0 && stats.routineCompletionPercent >= 70) {
    return "Keep your streak alive";
  }
  // Recognise task productivity.
  if (stats.tasksCompleted > 0) {
    return "Great job checking off tasks! Keep it up";
  }
  // Encourage longer focus sessions.
  if (stats.focusMinutes >= 60) {
    return "Nice focus today! Keep going";
  }
  // Compare focus minutes against yesterday's progress when available.
  if (yesterdayStats && stats.focusMinutes > yesterdayStats.focusMinutes) {
    return "You're ahead of yesterday";
  }
  // Default encouragement.
  return "One more session to level up";
}

function readStoredRecords<T>(key: string, parseRecord: (id: string, data: DocumentData) => T | null) {
  if (typeof window === "undefined") return [];

  try {
    const rawValue = window.localStorage.getItem(key);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : [];
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .map((record) => {
        if (!record || typeof record !== "object") return null;
        const candidate = record as DocumentData;
        return typeof candidate.id === "string" ? parseRecord(candidate.id, candidate) : null;
      })
      .filter((record): record is T => Boolean(record));
  } catch {
    return [];
  }
}

function readStoredGroupTasks(groupId: string) {
  if (typeof window === "undefined") return [];

  try {
    const rawValue = window.localStorage.getItem(previewStorageKeys.groupTasks);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : {};
    if (!parsedValue || typeof parsedValue !== "object" || !Array.isArray((parsedValue as Record<string, unknown>)[groupId])) {
      return [];
    }

    return ((parsedValue as Record<string, unknown>)[groupId] as unknown[])
      .map((record) => {
        if (!record || typeof record !== "object") return null;
        const candidate = record as DocumentData;
        return typeof candidate.id === "string" ? parseGroupTask(candidate.id, candidate) : null;
      })
      .filter((task): task is GroupTask => Boolean(task));
  } catch {
    return [];
  }
}

function readStoredGroupSession(groupId: string) {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.localStorage.getItem(previewStorageKeys.groupSessions);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : {};
    if (!parsedValue || typeof parsedValue !== "object") return null;

    const storedSession = (parsedValue as Record<string, DocumentData>)[groupId];
    return storedSession ? parseStudySession(storedSession) : null;
  } catch {
    return null;
  }
}

function readStoredDailyStats(date: string) {
  if (typeof window === "undefined") return defaultDailyStats(date);

  try {
    const rawValue = window.localStorage.getItem(previewStorageKeys.dailyStats);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : {};
    if (!parsedValue || typeof parsedValue !== "object") return defaultDailyStats(date);

    const storedStats = (parsedValue as Record<string, DocumentData>)[date];
    return storedStats ? parseDailyStats(date, storedStats) : defaultDailyStats(date);
  } catch {
    return defaultDailyStats(date);
  }
}

function userDocPath(userId: string, collectionName: "tasks" | "meetings" | "notes" | "groups" | "dailyStats" | "routines" | "settings", documentId?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  return documentId ? doc(db, "users", userId, collectionName, documentId) : doc(collection(db, "users", userId, collectionName));
}

function readableFirebaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Firebase request failed.";

  if (message.includes("auth/configuration-not-found")) {
    return "Firebase Auth is not enabled for this project yet. In Firebase Console, enable Authentication, add Google as a sign-in provider, and make sure localhost is an authorized domain.";
  }

  if (message.includes("auth/unauthorized-domain")) {
    return "Firebase rejected this domain. Add localhost to Authentication > Settings > Authorized domains.";
  }

  return message;
}

let redirectResultPromise: Promise<UserCredential | null> | null = null;
const userDocumentInitPromises = new Map<string, Promise<void>>();

function userRootDocPath(userId: string) {
  if (!db) throw new Error("Firebase is not configured.");
  return doc(db, "users", userId);
}

function ensureUserDocument(firebaseUser: AppUser) {
  if (!db) return Promise.resolve();

  const existingPromise = userDocumentInitPromises.get(firebaseUser.uid);
  if (existingPromise) return existingPromise;

  const initPromise = getDoc(userRootDocPath(firebaseUser.uid)).then((snapshot) => {
    if (snapshot.exists()) return;

    return setDoc(userRootDocPath(firebaseUser.uid), {
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? "",
      name: firebaseUser.displayName ?? firebaseUser.email ?? "Orbitex user",
      createdAt: serverTimestamp(),
    });
  });

  userDocumentInitPromises.set(firebaseUser.uid, initPromise);
  return initPromise;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, fallback: T) {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), milliseconds);
    }),
  ]);
}

function getRedirectResultOnce(currentAuth: Auth) {
  redirectResultPromise ??= withTimeout(authPersistenceReady.then(() => getRedirectResult(currentAuth)), 3500, null);
  return redirectResultPromise;
}

function formatClockTime(totalMinutes: number) {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${meridiem}`;
}

function parseMeetingStart(time: string) {
  const normalizedTime = time.trim().toUpperCase();
  const match = normalizedTime.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];

  if (minutes > 59 || hours > 23) return null;

  if (meridiem === "AM") {
    if (hours === 12) hours = 0;
  }

  if (meridiem === "PM" && hours < 12) {
    hours += 12;
  }

  return hours * 60 + minutes;
}

export default function OrbitexApp() {
  const [activeView, setActiveView] = useState<View>("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [user, setUser] = useState<AppUser | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [dueDate, setDueDate] = useState(today);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("All");
  const [tasks, setTasks] = useState<Task[]>([]);

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(today);
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingDuration, setMeetingDuration] = useState("30");
  const [meetingType, setMeetingType] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  const [routineTitle, setRoutineTitle] = useState("");
  const [routineStart, setRoutineStart] = useState("09:00");
  const [routineEnd, setRoutineEnd] = useState("10:00");
  const [routineDuration, setRoutineDuration] = useState<StudyDuration>(25);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [routines, setRoutines] = useState<RoutineBlock[]>([]);

  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState("Not saved yet");
  const [groupName, setGroupName] = useState("");
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [groupJoinError, setGroupJoinError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupTaskTitle, setGroupTaskTitle] = useState("");
  const [groupTasks, setGroupTasks] = useState<GroupTask[]>([]);
  const [groupSession, setGroupSession] = useState<StudySession | null>(null);
  const [groupSessionDuration, setGroupSessionDuration] = useState<StudyDuration>(25);
  const [groups, setGroups] = useState<Group[]>([]);
  const [personalSession, setPersonalSession] = useState<StudySession | null>(null);
  const [personalSessionDuration, setPersonalSessionDuration] = useState<StudyDuration>(25);
  const [focusSessionTitle, setFocusSessionTitle] = useState("");
  const [timerNow, setTimerNow] = useState(0);
  const [dailyStats, setDailyStats] = useState<DailyStats>(() => defaultDailyStats());
  const [yesterdayStats, setYesterdayStats] = useState<DailyStats | null>(null);
  const recordedSessionKeysRef = useRef<Set<string>>(new Set());
  const recordStudySessionRef = useRef<((sessionKey: string, durationMinutes: number, groupId?: string, participantIds?: string[]) => Promise<void>) | null>(null);
  const previewMode = TEMP_AUTH_BYPASS && user?.uid === previewUser.uid;
  recordStudySessionRef.current = recordStudySession;

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setTimerNow(Date.now()), 0);
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (TEMP_AUTH_BYPASS) {
      queueMicrotask(() => {
        const storedTasks = readStoredRecords(previewStorageKeys.tasks, parseTask).map((task) =>
          !task.done && task.due < today ? { ...task, due: today, carriedOver: true } : task,
        );
        const storedMeetings = readStoredRecords(previewStorageKeys.meetings, parseMeeting);
        const storedRoutines = readStoredRecords(previewStorageKeys.routines, parseRoutine);
        const storedGroups = readStoredRecords(previewStorageKeys.groups, parseGroup).sort(
          (firstGroup, secondGroup) => secondGroup.createdAt - firstGroup.createdAt,
        );
        const storedNote = window.localStorage.getItem(previewStorageKeys.note) ?? "";
        const storedStats = readStoredDailyStats(today);
        const storedYesterdayStats = readStoredDailyStats(previousDateKey());

        window.localStorage.setItem(previewStorageKeys.tasks, JSON.stringify(storedTasks));
        setUser(previewUser);
        setTasks(storedTasks);
        setMeetings(storedMeetings);
        setRoutines(storedRoutines.length > 0 ? sortRoutines(storedRoutines) : defaultRoutineBlocks);
        setGroups(storedGroups);
        setDailyStats(storedStats);
        setYesterdayStats(storedYesterdayStats);
        setNote(storedNote);
        setLastSaved(storedNote ? "Loaded from preview storage" : "Ready to save");
        setReady(true);
        setAuthLoading(false);
        setDataLoading(false);
      });
      return;
    }

    if (!auth || !firebaseReady) {
      queueMicrotask(() => {
        console.info("[Orbitex Auth] auth checking skipped: Firebase config missing");
        setReady(false);
        setAuthLoading(false);
        setDataLoading(false);
      });
      return;
    }

    let mounted = true;
    let redirectChecked = false;
    let authStateChecked = false;
    let latestUser: FirebaseUser | null = null;
    const currentAuth = auth;
    let noUserTimer: number | null = null;

    console.info("[Orbitex Auth] auth checking");

    async function commitAuthState(source: string, resolvedUser: FirebaseUser | null) {
      if (!mounted) return;
      setReady(false);
      if (noUserTimer) {
        window.clearTimeout(noUserTimer);
        noUserTimer = null;
      }

      console.info(resolvedUser ? "[Orbitex Auth] user detected" : "[Orbitex Auth] no user", {
        source,
        uid: resolvedUser?.uid,
        email: resolvedUser?.email,
      });

      if (resolvedUser) {
        try {
          await ensureUserDocument(resolvedUser);
        } catch (error) {
          if (!mounted) return;
          setActionError(readableFirebaseError(error));
          setUser(null);
          setReady(false);
          setAuthLoading(false);
          setDataLoading(false);
          return;
        }
      }

      if (!mounted) return;
      setUser(resolvedUser);
      setActionError("");
      setActiveView("Dashboard");
      setTasks([]);
      setMeetings([]);
      setRoutines([]);
      setRoutineTitle("");
      setRoutineStart("09:00");
      setRoutineEnd("10:00");
      setRoutineDuration(25);
      setEditingRoutineId(null);
      setGroups([]);
      setGroupName("");
      setJoinInviteCode("");
      setGroupJoinError("");
      setSelectedGroupId(null);
      setGroupTaskTitle("");
      setGroupTasks([]);
      setGroupSession(null);
      setGroupSessionDuration(25);
      setPersonalSession(null);
      setPersonalSessionDuration(25);
      setFocusSessionTitle("");
      setDailyStats(defaultDailyStats());
      setYesterdayStats(null);
      setNote("");
      setNoteDirty(false);
      setLastSaved(resolvedUser ? "Loading from Firestore..." : "Not saved yet");
      setReady(Boolean(resolvedUser));
      setDataLoading(Boolean(resolvedUser));
      setAuthLoading(false);
    }

    function applyAuthState(source: string) {
      if (!mounted || !redirectChecked || !authStateChecked) return;

      if (latestUser) {
        void commitAuthState(source, latestUser);
        return;
      }

      if (noUserTimer) window.clearTimeout(noUserTimer);
      console.info("[Orbitex Auth] no user, checking currentUser before showing login", { source });
      noUserTimer = window.setTimeout(() => {
        const settledUser = latestUser ?? currentAuth.currentUser;
        void commitAuthState(`${source} currentUser check`, settledUser);
      }, 600);
    }

    const unsubscribe = onAuthStateChanged(currentAuth, (nextUser) => {
      latestUser = nextUser;
      authStateChecked = true;
      console.info(nextUser ? "[Orbitex Auth] onAuthStateChanged user detected" : "[Orbitex Auth] onAuthStateChanged no user", {
        uid: nextUser?.uid,
        email: nextUser?.email,
      });
      applyAuthState("onAuthStateChanged");
    });

    void getRedirectResultOnce(currentAuth)
      .then((result) => {
        redirectChecked = true;
        console.info("[Orbitex Auth] redirect result", {
          hasResult: Boolean(result),
          uid: result?.user?.uid,
          email: result?.user?.email,
        });

        if (result?.user) {
          latestUser = result.user;
        }

        applyAuthState("redirect result");
      })
      .catch((error: Error) => {
        redirectChecked = true;
        console.info("[Orbitex Auth] redirect result error", error.message);
        setActionError(readableFirebaseError(error));
        applyAuthState("redirect error");
      });

    return () => {
      mounted = false;
      if (noUserTimer) window.clearTimeout(noUserTimer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      collection(db, "users", user.uid, "tasks"),
      (snapshot) => {
        const nextTasks = snapshot.docs
          .map((taskDocument) => parseTask(taskDocument.id, taskDocument.data()))
          .filter((task): task is Task => Boolean(task));

        setTasks(nextTasks);
        setDataLoading(false);

        nextTasks.forEach((task) => {
          if (!task.done && task.due < today) {
            void updateDoc(userDocPath(user.uid, "tasks", task.id), {
              due: today,
              carriedOver: true,
            });
          }
        });
      },
      (error) => {
        setActionError(error.message);
        setDataLoading(false);
      },
    );

    return unsubscribe;
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      collection(db, "users", user.uid, "meetings"),
      (snapshot) => {
        const nextMeetings = snapshot.docs
          .map((meetingDocument) => parseMeeting(meetingDocument.id, meetingDocument.data()))
          .filter((meeting): meeting is Meeting => Boolean(meeting));

        setMeetings(nextMeetings);
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      collection(db, "users", user.uid, "routines"),
      (snapshot) => {
        const nextRoutines = snapshot.docs
          .map((routineDocument) => parseRoutine(routineDocument.id, routineDocument.data()))
          .filter((routine): routine is RoutineBlock => Boolean(routine));

        if (nextRoutines.length === 0) {
          void getDoc(userDocPath(user.uid, "settings", "routines"))
            .then((settingsSnapshot) => {
              if (settingsSnapshot.exists() && settingsSnapshot.data().seeded) {
                setRoutines([]);
                return;
              }

              void Promise.all([
                ...defaultRoutineBlocks.map((routine) =>
                  setDoc(userDocPath(user.uid, "routines", routine.id), {
                    title: routine.title,
                    startMinutes: routine.startMinutes,
                    endMinutes: routine.endMinutes,
                    defaultDuration: routine.defaultDuration,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  }),
                ),
                setDoc(userDocPath(user.uid, "settings", "routines"), { seeded: true, updatedAt: Date.now() }, { merge: true }),
              ]).catch((error: Error) => setActionError(error.message));
            })
            .catch((error: Error) => setActionError(error.message));
          return;
        }

        setRoutines(sortRoutines(nextRoutines));
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      query(collection(db, "groups"), where("members", "array-contains", user.uid)),
      (snapshot) => {
        const nextGroups = snapshot.docs
          .map((groupDocument) => parseGroup(groupDocument.id, groupDocument.data()))
          .filter((group): group is Group => Boolean(group))
          .sort((firstGroup, secondGroup) => secondGroup.createdAt - firstGroup.createdAt);

        setGroups(nextGroups);
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (!selectedGroupId) {
      return;
    }

    if (previewMode) {
      const nextGroupTasks = sortGroupTasks(readStoredGroupTasks(selectedGroupId));
      const nextGroupSession = readStoredGroupSession(selectedGroupId);
      queueMicrotask(() => {
        setGroupTasks(nextGroupTasks);
        setGroupSession(nextGroupSession);
        setGroupTaskTitle("");
      });
      return;
    }

    if (!ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      collection(db, "groups", selectedGroupId, "tasks"),
      (snapshot) => {
        const nextGroupTasks = snapshot.docs
          .map((taskDocument) => parseGroupTask(taskDocument.id, taskDocument.data()))
          .filter((task): task is GroupTask => Boolean(task));

        setGroupTasks(sortGroupTasks(nextGroupTasks));
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, selectedGroupId, user]);

  useEffect(() => {
    if (!selectedGroupId || previewMode || !ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      doc(db, "groups", selectedGroupId, "session", "current"),
      (snapshot) => {
        setGroupSession(snapshot.exists() ? parseStudySession(snapshot.data()) : null);
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, selectedGroupId, user]);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    void setDoc(
      userDocPath(user.uid, "dailyStats", today),
      {
        appOpened: true,
        date: today,
        updatedAt: Date.now(),
      },
      { merge: true },
    ).catch((error: Error) => setActionError(error.message));

    const unsubscribe = onSnapshot(
      userDocPath(user.uid, "dailyStats", today),
      (snapshot) => {
        setDailyStats(snapshot.exists() ? parseDailyStats(snapshot.id, snapshot.data()) : defaultDailyStats(today));
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    let mounted = true;
    void getDoc(userDocPath(user.uid, "dailyStats", previousDateKey()))
      .then((snapshot) => {
        if (!mounted) return;
        setYesterdayStats(snapshot.exists() ? parseDailyStats(snapshot.id, snapshot.data()) : defaultDailyStats(previousDateKey()));
      })
      .catch((error: Error) => setActionError(error.message));

    return () => {
      mounted = false;
    };
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (previewMode || !ready || !db || !user) return;

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid, "notes", noteDocumentId),
      (snapshot) => {
        const savedNote = snapshot.exists() && typeof snapshot.data().content === "string" ? snapshot.data().content : "";
        setNote(savedNote);
        setNoteDirty(false);
        setLastSaved(snapshot.exists() ? "Synced from Firestore" : "Ready to save");
      },
      (error) => setActionError(error.message),
    );

    return unsubscribe;
  }, [previewMode, ready, user]);

  useEffect(() => {
    if (previewMode && noteDirty) {
      const saveTimer = window.setTimeout(() => {
        window.localStorage.setItem(previewStorageKeys.note, note);
        setNoteDirty(false);
        setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      }, 350);

      return () => window.clearTimeout(saveTimer);
    }

    if (!ready || !db || !user || !noteDirty) return;

    const database = db;
    const currentUser = user;
    const saveTimer = window.setTimeout(() => {
      void setDoc(
        doc(database, "users", currentUser.uid, "notes", noteDocumentId),
        {
          content: note,
          updatedAt: Date.now(),
        },
        { merge: true },
      )
        .then(() => {
          setNoteDirty(false);
          setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        })
        .catch((error: Error) => {
          setActionError(error.message);
          setLastSaved("Save failed");
        });
    }, 700);

    return () => window.clearTimeout(saveTimer);
  }, [note, noteDirty, previewMode, ready, user]);

  useEffect(() => {
    if (!ready && !previewMode) return;
    if (!personalSession || personalSession.statsRecordedAt || sessionRemainingSeconds(personalSession, timerNow) > 0) return;

    const sessionKey = `personal:${personalSession.startedAt}`;
    if (recordedSessionKeysRef.current.has(sessionKey)) return;

    recordedSessionKeysRef.current.add(sessionKey);
    void recordStudySessionRef.current?.(`personal:${personalSession.startedAt}`, personalSession.durationMinutes).catch((error: Error) => {
      recordedSessionKeysRef.current.delete(sessionKey);
      setActionError(error.message);
    });
  }, [personalSession, previewMode, ready, timerNow]);

  useEffect(() => {
    if (!ready && !previewMode) return;
    if (!groupSession || !selectedGroupId || sessionRemainingSeconds(groupSession, timerNow) > 0) return;

    const sessionKey = `group:${selectedGroupId}:${groupSession.startedAt}`;
    const userParticipated = Boolean(user && groupSession.participantIds.includes(user.uid));
    if (userParticipated && !recordedSessionKeysRef.current.has(sessionKey)) {
      recordedSessionKeysRef.current.add(sessionKey);
      void recordStudySessionRef.current?.(sessionKey, groupSession.durationMinutes, selectedGroupId, groupSession.participantIds).catch((error: Error) => {
        recordedSessionKeysRef.current.delete(sessionKey);
        setActionError(error.message);
      });
    }

    if (!groupSession.statsRecordedAt) {
      const recordedAt = Date.now();
      if (previewMode) {
        persistPreviewGroupSession(selectedGroupId, { ...groupSession, statsRecordedAt: recordedAt });
      } else if (db) {
        void updateDoc(doc(db, "groups", selectedGroupId, "session", "current"), {
          statsRecordedAt: recordedAt,
          updatedAt: recordedAt,
        }).catch((error: Error) => setActionError(error.message));
      }
    }
  }, [groupSession, selectedGroupId, timerNow, user, previewMode, ready]);

  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);
  const sortedMeetings = useMemo(() => sortMeetings(meetings), [meetings]);
  const sortedRoutines = useMemo(() => sortRoutines(routines), [routines]);
  const completedTasks = tasks.filter((task) => task.done).length;
  const activeTasks = tasks.length - completedTasks;
  const dueTodayTasks = tasks.filter((task) => task.due === today).length;
  const progress = tasks.length === 0 ? 0 : Math.round((completedTasks / tasks.length) * 100);
  const upcomingMeetings = sortedMeetings.filter((meeting) => meeting.date >= today);
  const noteCards = note
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  const filteredTasks = sortedTasks.filter((task) => {
    if (taskFilter === "Active") return !task.done;
    if (taskFilter === "Completed") return task.done;
    return true;
  });
  const { currentRoutine, nextRoutine } = useMemo(() => routineStatus(timerNow, sortedRoutines), [timerNow, sortedRoutines]);
  const routineCompletion = dailyStats.routineCompletionPercent;
  const currentStreak = dailyStats.currentStreak;
  const bestStreak = dailyStats.bestStreak;
  const dashboardMessage = motivationalMessage(dailyStats, yesterdayStats);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

  function switchView(view: View) {
    setActiveView(view);
    setSidebarOpen(false);
  }

  function persistPreviewTasks(nextTasks: Task[]) {
    setTasks(nextTasks);
    window.localStorage.setItem(previewStorageKeys.tasks, JSON.stringify(nextTasks));
  }

  function persistPreviewMeetings(nextMeetings: Meeting[]) {
    setMeetings(nextMeetings);
    window.localStorage.setItem(previewStorageKeys.meetings, JSON.stringify(nextMeetings));
  }

  function persistPreviewRoutines(nextRoutines: RoutineBlock[]) {
    const sortedRoutines = sortRoutines(nextRoutines);
    setRoutines(sortedRoutines);
    window.localStorage.setItem(previewStorageKeys.routines, JSON.stringify(sortedRoutines));
  }

  function persistPreviewDailyStats(nextStats: DailyStats) {
    try {
      const rawValue = window.localStorage.getItem(previewStorageKeys.dailyStats);
      const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : {};
      const nextValue = parsedValue && typeof parsedValue === "object" ? { ...(parsedValue as Record<string, unknown>) } : {};
      nextValue[nextStats.date] = nextStats;
      setDailyStats(nextStats);
      window.localStorage.setItem(previewStorageKeys.dailyStats, JSON.stringify(nextValue));
    } catch {
      setDailyStats(nextStats);
      window.localStorage.setItem(previewStorageKeys.dailyStats, JSON.stringify({ [nextStats.date]: nextStats }));
    }
  }

  function persistPreviewGroups(nextGroups: Group[]) {
    setGroups(nextGroups);
    window.localStorage.setItem(previewStorageKeys.groups, JSON.stringify(nextGroups));
  }

  function persistPreviewGroupTasks(groupId: string, nextTasks: GroupTask[]) {
    try {
      const rawValue = window.localStorage.getItem(previewStorageKeys.groupTasks);
      const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : {};
      const nextValue = parsedValue && typeof parsedValue === "object" ? { ...(parsedValue as Record<string, unknown>) } : {};
      const sortedTasks = sortGroupTasks(nextTasks);
      nextValue[groupId] = sortedTasks;
      setGroupTasks(sortedTasks);
      window.localStorage.setItem(previewStorageKeys.groupTasks, JSON.stringify(nextValue));
    } catch {
      const sortedTasks = sortGroupTasks(nextTasks);
      setGroupTasks(sortedTasks);
      window.localStorage.setItem(previewStorageKeys.groupTasks, JSON.stringify({ [groupId]: sortedTasks }));
    }
  }

  function persistPreviewGroupSession(groupId: string, nextSession: StudySession) {
    try {
      const rawValue = window.localStorage.getItem(previewStorageKeys.groupSessions);
      const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : {};
      const nextValue = parsedValue && typeof parsedValue === "object" ? { ...(parsedValue as Record<string, unknown>) } : {};
      nextValue[groupId] = nextSession;
      setGroupSession(nextSession);
      window.localStorage.setItem(previewStorageKeys.groupSessions, JSON.stringify(nextValue));
    } catch {
      setGroupSession(nextSession);
      window.localStorage.setItem(previewStorageKeys.groupSessions, JSON.stringify({ [groupId]: nextSession }));
    }
  }

  async function saveDailyStats(nextStats: Partial<DailyStats> & { date?: string }) {
    const normalizedStats: DailyStats = {
      ...dailyStats,
      ...nextStats,
      date: nextStats.date ?? today,
      updatedAt: Date.now(),
    };

    if (previewMode) {
      persistPreviewDailyStats(normalizedStats);
      return;
    }

    if (!ready || !db || !user) return;

    await setDoc(
      userDocPath(user.uid, "dailyStats", normalizedStats.date),
      {
        ...nextStats,
        date: normalizedStats.date,
        updatedAt: normalizedStats.updatedAt,
      },
      { merge: true },
    );
  }

  async function updateTaskCompletionStats(nextTasks: Task[]) {
    if (!user) return;

    const tasksCompletedToday = nextTasks.filter((task) => task.done && task.completedAt && dateKey(new Date(task.completedAt)) === today).length;
    await saveDailyStats({
      ...dailyStats,
      date: today,
      appOpened: true,
      tasksCompleted: tasksCompletedToday,
    });
  }

  async function updateRoutineChecklist(routineId: string) {
    if (!user) return;

    const routine = routines.find((candidate) => candidate.id === routineId);
    if (!routine) return;

    const currentlyCompleted = dailyStats.routineCompletedBlocks.includes(routine.id) || dailyStats.routineCompletedBlocks.includes(routine.title);
    const nextCompletedBlocks = currentlyCompleted
      ? dailyStats.routineCompletedBlocks.filter((title) => title !== routine.id && title !== routine.title)
      : [...dailyStats.routineCompletedBlocks, routine.id];
    const nextCompletion = routineChecklistPercent(nextCompletedBlocks, routines);
    const successfulDay = nextCompletion >= 70;
    let nextCurrentStreak = dailyStats.currentStreak;
    let nextBestStreak = dailyStats.bestStreak;

    if (successfulDay) {
      const previousStats = yesterdayStats ?? defaultDailyStats(previousDateKey());
      nextCurrentStreak = dailyStats.successfulDay ? Math.max(1, dailyStats.currentStreak) : (previousStats.successfulDay ? previousStats.currentStreak : 0) + 1;
      nextBestStreak = Math.max(dailyStats.bestStreak, previousStats.bestStreak, nextCurrentStreak);
    } else {
      nextCurrentStreak = 0;
    }

    await saveDailyStats({
      ...dailyStats,
      date: today,
      appOpened: true,
      routineCompletedBlocks: nextCompletedBlocks,
      routineCompletionPercent: nextCompletion,
      successfulDay,
      currentStreak: nextCurrentStreak,
      bestStreak: nextBestStreak,
    });
  }

  async function recordStudySession(sessionKey: string, durationMinutes: number, groupId?: string, participantIds?: string[]) {
    if (!user || dailyStats.recordedStudySessionIds.includes(sessionKey)) return;
    if (!previewMode && !ready) return;

    if (previewMode) {
      persistPreviewDailyStats({
        ...dailyStats,
        date: today,
        appOpened: true,
        studySessionsCompleted: dailyStats.studySessionsCompleted + 1,
        focusMinutes: dailyStats.focusMinutes + durationMinutes,
        recordedStudySessionIds: [...dailyStats.recordedStudySessionIds, sessionKey],
        updatedAt: Date.now(),
      });
    } else if (db) {
      const statsSnapshot = await getDoc(userDocPath(user.uid, "dailyStats", today));
      const latestStats = statsSnapshot.exists() ? parseDailyStats(statsSnapshot.id, statsSnapshot.data()) : defaultDailyStats(today);
      if (!latestStats.recordedStudySessionIds.includes(sessionKey)) {
        await setDoc(
          userDocPath(user.uid, "dailyStats", today),
          {
            appOpened: true,
            date: today,
            studySessionsCompleted: increment(1),
            focusMinutes: increment(durationMinutes),
            recordedStudySessionIds: arrayUnion(sessionKey),
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }
    }

    if (groupId && participantIds && participantIds.length > 0) {
      await updateGroupLeaderboard(groupId, participantIds.map((participantId, index) => ({
        id: participantId,
        name: groupSession?.participantNames[index] ?? groups.find((group) => group.id === groupId)?.memberProfiles.find((member) => member.id === participantId)?.name ?? "Orbitex user",
        focusMinutes: durationMinutes,
        completedGroupTasks: 0,
      })));
    }
  }

  async function updateGroupLeaderboard(
    groupId: string,
    updates: Array<{ id: string; name: string; focusMinutes: number; completedGroupTasks: number }>,
  ) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group || updates.length === 0) return;

    const currentWeek = weekKey();
    const baseEntries = parseLeaderboard(group.leaderboard, group.memberProfiles).map((entry) =>
      entry.weekKey === currentWeek
        ? entry
        : {
            ...entry,
            weekKey: currentWeek,
            focusMinutes: 0,
            completedGroupTasks: 0,
          },
    );

    const nextEntries = [...baseEntries];
    updates.forEach((update) => {
      const existingIndex = nextEntries.findIndex((entry) => entry.id === update.id);
      const existingEntry = nextEntries[existingIndex] ?? {
        id: update.id,
        name: update.name,
        weekKey: currentWeek,
        focusMinutes: 0,
        completedGroupTasks: 0,
      };
      const nextEntry: GroupLeaderboardEntry = {
        ...existingEntry,
        name: update.name || existingEntry.name,
        weekKey: currentWeek,
        focusMinutes: Math.max(0, existingEntry.focusMinutes + update.focusMinutes),
        completedGroupTasks: Math.max(0, existingEntry.completedGroupTasks + update.completedGroupTasks),
      };

      if (existingIndex >= 0) {
        nextEntries[existingIndex] = nextEntry;
      } else {
        nextEntries.push(nextEntry);
      }
    });

    if (previewMode) {
      persistPreviewGroups(groups.map((candidate) => (candidate.id === groupId ? { ...candidate, leaderboard: nextEntries } : candidate)));
      return;
    }

    if (!db) return;
    await updateDoc(doc(db, "groups", groupId), {
      leaderboard: nextEntries,
      updatedAt: Date.now(),
    });
  }

  function openGroupDashboard(groupId: string) {
    setSelectedGroupId(groupId);
    setGroupTasks([]);
    setGroupTaskTitle("");
    setGroupSession(null);
    setGroupJoinError("");
  }

  function closeGroupDashboard() {
    setSelectedGroupId(null);
    setGroupTasks([]);
    setGroupTaskTitle("");
    setGroupSession(null);
  }

  function resetTaskForm() {
    setTaskTitle("");
    setPriority("Medium");
    setDueDate(today);
    setEditingTaskId(null);
  }

  function resetRoutineForm() {
    setRoutineTitle("");
    setRoutineStart("09:00");
    setRoutineEnd("10:00");
    setRoutineDuration(25);
    setEditingRoutineId(null);
  }

  function startEditRoutine(routine: RoutineBlock) {
    setRoutineTitle(routine.title);
    setRoutineStart(formatTimeInput(routine.startMinutes));
    setRoutineEnd(formatTimeInput(routine.endMinutes));
    setRoutineDuration(routine.defaultDuration);
    setEditingRoutineId(routine.id);
    setActiveView("Routine");
  }

  async function submitRoutine() {
    if (!user || !routineTitle.trim()) return;

    const startMinutes = parseTimeInput(routineStart);
    const endMinutes = parseTimeInput(routineEnd);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      setActionError("Routine end time must be after the start time.");
      return;
    }

    const routineId = editingRoutineId ?? createLocalId("routine");
    const nextRoutine: RoutineBlock = {
      id: routineId,
      title: routineTitle.trim(),
      startMinutes,
      endMinutes,
      defaultDuration: routineDuration,
    };

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewRoutines(
          editingRoutineId
            ? routines.map((routine) => (routine.id === editingRoutineId ? nextRoutine : routine))
            : [...routines, nextRoutine],
        );
        resetRoutineForm();
        return;
      }

      await setDoc(
        userDocPath(user.uid, "routines", routineId),
        {
          title: nextRoutine.title,
          startMinutes: nextRoutine.startMinutes,
          endMinutes: nextRoutine.endMinutes,
          defaultDuration: nextRoutine.defaultDuration,
          updatedAt: Date.now(),
          ...(editingRoutineId ? {} : { createdAt: Date.now() }),
        },
        { merge: true },
      );
      await setDoc(userDocPath(user.uid, "settings", "routines"), { seeded: true, updatedAt: Date.now() }, { merge: true });
      resetRoutineForm();
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function deleteRoutine(id: string) {
    if (!user) return;

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewRoutines(routines.filter((routine) => routine.id !== id));
        resetRoutineForm();
        return;
      }

      await deleteDoc(userDocPath(user.uid, "routines", id));
      await setDoc(userDocPath(user.uid, "settings", "routines"), { seeded: true, updatedAt: Date.now() }, { merge: true });
      resetRoutineForm();
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function signInWithGoogle() {
    if (TEMP_AUTH_BYPASS) {
      setUser(previewUser);
      setReady(true);
      setAuthLoading(false);
      setDataLoading(false);
      return;
    }

    if (!auth) return;

    try {
      setActionError("");
      console.info("[Orbitex Auth] starting Google sign-in with popup");
      await authPersistenceReady;
      const result = await signInWithPopup(auth, googleProvider);
      console.info("[Orbitex Auth] popup sign-in result", {
        uid: result.user.uid,
        email: result.user.email,
      });
      await ensureUserDocument(result.user);
      setUser(result.user);
      setReady(true);
      setAuthLoading(false);
      setDataLoading(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      console.info("[Orbitex Auth] popup sign-in failed", message);

      if (message.includes("auth/popup-blocked") || message.includes("auth/cancelled-popup-request")) {
        try {
          console.info("[Orbitex Auth] falling back to Google sign-in with redirect");
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          setActionError(readableFirebaseError(redirectError));
          return;
        }
      }

      setActionError(readableFirebaseError(error));
    }
  }

  async function logout() {
    if (previewMode) {
      setActionError("Google sign-in is temporarily disabled while preview mode is active.");
      return;
    }

    if (!auth) return;

    try {
      setActionError("");
      await signOut(auth);
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function submitTask() {
    if (!user || !taskTitle.trim()) return;

    const nextTask = {
      title: taskTitle.trim(),
      priority,
      due: normalizeDueDate(dueDate),
      done: false,
      carriedOver: false,
      updatedAt: Date.now(),
    };

    try {
      setActionError("");

      if (previewMode) {
        if (editingTaskId !== null) {
          persistPreviewTasks(
            tasks.map((task) =>
              task.id === editingTaskId
                ? {
                    ...task,
                    ...nextTask,
                    done: task.done,
                  }
                : task,
            ),
          );
        } else {
          persistPreviewTasks([
            ...tasks,
            {
              id: createLocalId("task"),
              ...nextTask,
              createdAt: Date.now(),
            },
          ]);
        }

        resetTaskForm();
        return;
      }

      if (editingTaskId !== null) {
        await updateDoc(userDocPath(user.uid, "tasks", editingTaskId), {
          ...nextTask,
          done: tasks.find((task) => task.id === editingTaskId)?.done ?? false,
        });
      } else {
        const taskRef = userDocPath(user.uid, "tasks");
        await setDoc(taskRef, {
          ...nextTask,
          createdAt: Date.now(),
        });
      }

      resetTaskForm();
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  function startEditTask(task: Task) {
    setTaskTitle(task.title);
    setPriority(task.priority);
    setDueDate(task.due);
    setEditingTaskId(task.id);
    setActiveView("Tasks");
  }

  async function toggleTask(id: string) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!user || !task) return;
    const nextDone = !task.done;
    const completedAt = nextDone ? Date.now() : 0;
    const nextTasks = tasks.map((candidate) =>
      candidate.id === id
        ? {
            ...candidate,
            done: nextDone,
            completedAt: nextDone ? completedAt : undefined,
          }
        : candidate,
    );

    try {
      setActionError("");
      if (previewMode) {
        persistPreviewTasks(nextTasks);
        await updateTaskCompletionStats(nextTasks);
        return;
      }

      await updateDoc(userDocPath(user.uid, "tasks", id), {
        done: nextDone,
        completedAt,
        updatedAt: Date.now(),
      });
      await updateTaskCompletionStats(nextTasks);
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function deleteTask(id: string) {
    if (!user) return;

    try {
      setActionError("");
      if (previewMode) {
        persistPreviewTasks(tasks.filter((task) => task.id !== id));
        return;
      }

      await deleteDoc(userDocPath(user.uid, "tasks", id));
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function submitMeeting() {
    if (!user || !meetingTitle.trim() || !meetingDate.trim() || !meetingTime.trim() || !meetingDuration.trim() || !meetingType.trim()) return;

    try {
      setActionError("");
      if (previewMode) {
        persistPreviewMeetings([
          ...meetings,
          {
            id: createLocalId("meeting"),
            title: meetingTitle.trim(),
            date: normalizeDueDate(meetingDate),
            time: meetingTime.trim(),
            duration: normalizeMeetingDuration(meetingDuration),
            type: meetingType.trim(),
            createdAt: Date.now(),
          },
        ]);
        setMeetingTitle("");
        setMeetingDate(today);
        setMeetingTime("");
        setMeetingDuration("30");
        setMeetingType("");
        return;
      }

      const meetingRef = userDocPath(user.uid, "meetings");
      await setDoc(meetingRef, {
        title: meetingTitle.trim(),
        date: normalizeDueDate(meetingDate),
        time: meetingTime.trim(),
        duration: normalizeMeetingDuration(meetingDuration),
        type: meetingType.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setMeetingTitle("");
      setMeetingDate(today);
      setMeetingTime("");
      setMeetingDuration("30");
      setMeetingType("");
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function deleteMeeting(id: string) {
    if (!user) return;

    try {
      setActionError("");
      if (previewMode) {
        persistPreviewMeetings(meetings.filter((meeting) => meeting.id !== id));
        return;
      }

      await deleteDoc(userDocPath(user.uid, "meetings", id));
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function createGroup() {
    if (!user || !groupName.trim()) return;

    try {
      setActionError("");
      const now = Date.now();
      const nextGroup = {
        id: createLocalId("group"),
        name: groupName.trim(),
        inviteCode: generateInviteCode(groups.map((group) => group.inviteCode)),
      creatorId: user.uid,
      members: [user.uid],
      memberProfiles: [userGroupProfile(user, "creator")],
      leaderboard: [
        {
          id: user.uid,
          name: displayNameForUser(user),
          weekKey: weekKey(),
          focusMinutes: 0,
          completedGroupTasks: 0,
        },
      ],
      createdAt: now,
    };

      if (previewMode) {
        persistPreviewGroups([nextGroup, ...groups]);
        setGroupName("");
        setSelectedGroupId(nextGroup.id);
        return;
      }

      if (!db) return;

      const groupRef = doc(collection(db, "groups"));
      await setDoc(groupRef, {
        name: nextGroup.name,
        inviteCode: nextGroup.inviteCode,
        creatorId: nextGroup.creatorId,
        members: nextGroup.members,
        memberProfiles: nextGroup.memberProfiles,
        leaderboard: nextGroup.leaderboard,
        createdAt: nextGroup.createdAt,
        updatedAt: now,
      });

      setGroupName("");
      setSelectedGroupId(groupRef.id);
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function joinGroup() {
    if (!user || !joinInviteCode.trim()) return;

    const normalizedCode = joinInviteCode.trim().toUpperCase();

    try {
      setActionError("");
      setGroupJoinError("");

      if (previewMode) {
        const targetGroup = groups.find((group) => group.inviteCode.toUpperCase() === normalizedCode);
        if (!targetGroup) {
          setGroupJoinError("Invalid code");
          return;
        }

        if (!targetGroup.members.includes(user.uid)) {
          persistPreviewGroups(
            groups.map((group) =>
              group.id === targetGroup.id
                ? {
                    ...group,
                    members: [...group.members, user.uid],
                    memberProfiles: [...group.memberProfiles, userGroupProfile(user, "member")],
                    leaderboard: [
                      ...group.leaderboard,
                      {
                        id: user.uid,
                        name: displayNameForUser(user),
                        weekKey: weekKey(),
                        focusMinutes: 0,
                        completedGroupTasks: 0,
                      },
                    ],
                  }
                : group,
            ),
          );
        }

        setJoinInviteCode("");
        setSelectedGroupId(targetGroup.id);
        return;
      }

      if (!db) return;

      const matchingGroups = await getDocs(query(collection(db, "groups"), where("inviteCode", "==", normalizedCode)));
      const targetGroupDocument = matchingGroups.docs[0];

      if (!targetGroupDocument) {
        setGroupJoinError("Invalid code");
        return;
      }

      const targetGroup = parseGroup(targetGroupDocument.id, targetGroupDocument.data());
      if (!targetGroup) {
        setGroupJoinError("Invalid code");
        return;
      }

      if (!targetGroup.members.includes(user.uid)) {
        await updateDoc(targetGroupDocument.ref, {
          members: arrayUnion(user.uid),
          memberProfiles: arrayUnion(userGroupProfile(user, "member")),
          leaderboard: [
            ...targetGroup.leaderboard,
            {
              id: user.uid,
              name: displayNameForUser(user),
              weekKey: weekKey(),
              focusMinutes: 0,
              completedGroupTasks: 0,
            },
          ],
          updatedAt: Date.now(),
        });
      }

      setJoinInviteCode("");
      setSelectedGroupId(targetGroupDocument.id);
    } catch (error) {
      setGroupJoinError(readableFirebaseError(error));
    }
  }

  async function submitGroupTask() {
    if (!user || !selectedGroupId || !groupTaskTitle.trim()) return;

    const now = Date.now();
    const nextTask = {
      id: createLocalId("group-task"),
      title: groupTaskTitle.trim(),
      done: false,
      createdAt: now,
      createdBy: user.uid,
      createdByName: displayNameForUser(user),
    };

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewGroupTasks(selectedGroupId, [nextTask, ...groupTasks]);
        setGroupTaskTitle("");
        return;
      }

      if (!db) return;

      const taskRef = doc(collection(db, "groups", selectedGroupId, "tasks"));
      await setDoc(taskRef, {
        title: nextTask.title,
        done: nextTask.done,
        createdAt: nextTask.createdAt,
        createdBy: nextTask.createdBy,
        createdByName: nextTask.createdByName,
        updatedAt: now,
      });
      setGroupTaskTitle("");
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function toggleGroupTask(taskId: string) {
    if (!user || !selectedGroupId) return;

    const task = groupTasks.find((candidate) => candidate.id === taskId);
    if (!task) return;

    const nextDone = !task.done;
    const completionData = nextDone
      ? {
          completedBy: user.uid,
          completedByName: displayNameForUser(user),
          completedAt: Date.now(),
        }
      : {
          completedBy: "",
          completedByName: "",
          completedAt: 0,
        };

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewGroupTasks(
          selectedGroupId,
          groupTasks.map((candidate) =>
            candidate.id === taskId
              ? {
                  ...candidate,
                  done: nextDone,
                  ...completionData,
                }
              : candidate,
          ),
        );
        await updateGroupLeaderboard(selectedGroupId, [
          {
            id: nextDone ? user.uid : task.completedBy ?? user.uid,
            name: nextDone ? displayNameForUser(user) : task.completedByName ?? displayNameForUser(user),
            focusMinutes: 0,
            completedGroupTasks: nextDone ? 1 : -1,
          },
        ]);
        return;
      }

      if (!db) return;

      await updateDoc(doc(db, "groups", selectedGroupId, "tasks", taskId), {
        done: nextDone,
        ...completionData,
        updatedAt: Date.now(),
      });
      await updateGroupLeaderboard(selectedGroupId, [
        {
          id: nextDone ? user.uid : task.completedBy ?? user.uid,
          name: nextDone ? displayNameForUser(user) : task.completedByName ?? displayNameForUser(user),
          focusMinutes: 0,
          completedGroupTasks: nextDone ? 1 : -1,
        },
      ]);
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function deleteGroupTask(taskId: string) {
    if (!selectedGroupId) return;

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewGroupTasks(
          selectedGroupId,
          groupTasks.filter((task) => task.id !== taskId),
        );
        return;
      }

      if (!db) return;

      await deleteDoc(doc(db, "groups", selectedGroupId, "tasks", taskId));
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  function startPersonalSession(routine?: RoutineBlock, manualTitle?: string, durationOverride?: StudyDuration) {
    if (!user || sessionRemainingSeconds(personalSession, timerNow) > 0) return;

    const nextDuration = durationOverride ?? routine?.defaultDuration ?? personalSessionDuration;
    const nextTitle = routine?.title ?? manualTitle?.trim() ?? "Personal Study Session";
    const now = Date.now();
    setPersonalSession({
      title: nextTitle || "Personal Study Session",
      durationMinutes: nextDuration,
      startedAt: now,
      endsAt: now + nextDuration * 60 * 1000,
      startedBy: user.uid,
      startedByName: displayNameForUser(user),
      participantIds: [user.uid],
      participantNames: [displayNameForUser(user)],
    });
    setFocusSessionTitle("");
  }

  async function startGroupSession(routine?: RoutineBlock, manualTitle?: string, durationOverride?: StudyDuration) {
    if (!user || !selectedGroupId || sessionRemainingSeconds(groupSession, timerNow) > 0) return;

    const nextDuration = durationOverride ?? routine?.defaultDuration ?? groupSessionDuration;
    const nextTitle = routine?.title ?? manualTitle?.trim() ?? "Group Study Session";
    const now = Date.now();
    const nextSession: StudySession = {
      title: nextTitle || "Group Study Session",
      durationMinutes: nextDuration,
      startedAt: now,
      endsAt: now + nextDuration * 60 * 1000,
      startedBy: user.uid,
      startedByName: displayNameForUser(user),
      participantIds: [user.uid],
      participantNames: [displayNameForUser(user)],
    };

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewGroupSession(selectedGroupId, nextSession);
        setFocusSessionTitle("");
        return;
      }

      if (!db) return;

      await setDoc(doc(db, "groups", selectedGroupId, "session", "current"), {
        ...nextSession,
        updatedAt: now,
      });
      setFocusSessionTitle("");
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  async function joinGroupSession() {
    if (!user || !selectedGroupId || !groupSession || sessionRemainingSeconds(groupSession, timerNow) <= 0) return;
    if (groupSession.participantIds.includes(user.uid)) return;

    const userName = displayNameForUser(user);

    try {
      setActionError("");

      if (previewMode) {
        persistPreviewGroupSession(selectedGroupId, {
          ...groupSession,
          participantIds: [...groupSession.participantIds, user.uid],
          participantNames: [...groupSession.participantNames, userName],
        });
        return;
      }

      if (!db) return;

      await updateDoc(doc(db, "groups", selectedGroupId, "session", "current"), {
        participantIds: arrayUnion(user.uid),
        participantNames: arrayUnion(userName),
        updatedAt: Date.now(),
      });
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  function updateNote(value: string) {
    setNote(value);
    setNoteDirty(true);
    setLastSaved("Saving...");
  }

  function exportData() {
    const payload = JSON.stringify({ tasks, meetings, routines, groups, dailyStats, note, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "orbitex-firestore-data.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function resetCloudData() {
    const resetTarget = previewMode ? "preview storage" : "Firestore for this account";
    if (!user || !window.confirm(`Delete all Orbitex tasks, meetings, routines, groups, notes, and stats from ${resetTarget}?`)) return;

    try {
      setActionError("");
      if (previewMode) {
        persistPreviewTasks([]);
        persistPreviewMeetings([]);
        persistPreviewRoutines([]);
        persistPreviewGroups([]);
        window.localStorage.removeItem(previewStorageKeys.groupTasks);
        window.localStorage.removeItem(previewStorageKeys.groupSessions);
        window.localStorage.removeItem(previewStorageKeys.dailyStats);
        window.localStorage.removeItem(previewStorageKeys.note);
        resetTaskForm();
        setGroupName("");
        setJoinInviteCode("");
        setGroupJoinError("");
        setSelectedGroupId(null);
        setGroupTaskTitle("");
        setGroupTasks([]);
        setGroupSession(null);
        setPersonalSession(null);
        resetRoutineForm();
        setDailyStats(defaultDailyStats());
        setYesterdayStats(null);
        setNote("");
        setNoteDirty(false);
        setLastSaved("Preview data reset");
        return;
      }

      if (!db) return;
      const database = db;

      await Promise.all([
        ...tasks.map((task) => deleteDoc(userDocPath(user.uid, "tasks", task.id))),
        ...meetings.map((meeting) => deleteDoc(userDocPath(user.uid, "meetings", meeting.id))),
        ...routines.map((routine) => deleteDoc(userDocPath(user.uid, "routines", routine.id))),
        ...groups.filter((group) => group.creatorId === user.uid).map((group) => deleteDoc(doc(database, "groups", group.id))),
        deleteDoc(userDocPath(user.uid, "notes", noteDocumentId)),
        deleteDoc(userDocPath(user.uid, "dailyStats", today)),
        deleteDoc(userDocPath(user.uid, "settings", "routines")),
      ]);
      resetTaskForm();
      setGroupName("");
      setJoinInviteCode("");
      setGroupJoinError("");
      setSelectedGroupId(null);
      setGroupTaskTitle("");
      setGroupTasks([]);
      setGroupSession(null);
      setPersonalSession(null);
      setRoutines([]);
      resetRoutineForm();
      setDailyStats(defaultDailyStats());
      setYesterdayStats(null);
      setNote("");
      setNoteDirty(false);
      setLastSaved("Cloud data reset");
    } catch (error) {
      setActionError(readableFirebaseError(error));
    }
  }

  if (!TEMP_AUTH_BYPASS && (!firebaseReady || !auth || !db)) {
    return (
      <ShellBackground>
        <LoginCard
          title="Firebase config needed"
          subtitle="Add the NEXT_PUBLIC_FIREBASE_* values to .env.local, then restart the dev server."
          error="Missing Firebase config. Required: apiKey, authDomain, projectId, and appId."
        />
      </ShellBackground>
    );
  }

  if (authLoading) {
    return (
      <ShellBackground>
        <LoadingScreen label="Checking your Orbitex session..." />
      </ShellBackground>
    );
  }

  if (!user) {
    return (
      <ShellBackground>
        <LoginCard
          title="Welcome to Orbitex"
          subtitle="Sign in with Google to sync tasks, meetings, and notes through Firestore."
          error={actionError}
          onSignIn={signInWithGoogle}
        />
      </ShellBackground>
    );
  }

  if (!ready) {
    return (
      <ShellBackground>
        <LoadingScreen label="Setting up your workspace..." />
      </ShellBackground>
    );
  }

  return (
    <main className="min-h-screen bg-[#080A12] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(70,120,255,0.25),transparent_34%),radial-gradient(circle_at_top_right,rgba(150,80,255,0.18),transparent_30%)]" />

      <div className="relative z-10 flex min-h-screen">
        <aside
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } fixed z-30 h-full w-72 border-r border-white/10 bg-black/55 p-5 backdrop-blur-2xl transition md:static md:translate-x-0`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-cyan-300">Orbitex</p>
              <h1 className="mt-2 text-2xl font-semibold">Command Center</h1>
            </div>
            <button type="button" aria-label="Close sidebar" className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X />
            </button>
          </div>

          <nav className="mt-10 space-y-2">
            {navItems.map(([view, Icon]) => (
              <button
                type="button"
                key={view}
                onClick={() => switchView(view)}
                aria-current={activeView === view ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition ${
                  activeView === view
                    ? "border border-cyan-300/25 bg-cyan-300/15 text-cyan-100 shadow-[0_0_28px_rgba(103,232,249,0.12)]"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} /> {view}
              </button>
            ))}
          </nav>

          <div className="mt-10 rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-4 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
            <div className="flex items-center gap-2 text-cyan-200">
              <ShieldCheck size={18} /> Firestore sync active
            </div>
            <p className="mt-2 text-sm text-white/60">Signed in as {user.displayName ?? user.email ?? "Orbitex user"}.</p>
          </div>
        </aside>

        <section className="flex-1 p-4 md:p-8">
          <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Open sidebar"
                className="rounded-xl border border-white/10 p-2 md:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu />
              </button>
              <div>
                <p className="text-sm text-white/50">Today - {new Date().toDateString()}</p>
                <h2 className="text-4xl font-semibold tracking-tight md:text-6xl">{activeView}</h2>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
              <Search size={18} className="text-white/40" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-white/35"
                placeholder="Search stays local for now..."
              />
            </div>
          </header>

          {actionError && (
            <div className="mt-5 rounded-2xl border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100">{actionError}</div>
          )}

          {dataLoading ? (
            <div className="mt-8">
              <LoadingScreen label="Loading your Firestore workspace..." compact />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="mt-8"
              >
                {activeView === "Dashboard" && (
                  <DashboardView
                    tasks={sortedTasks}
                    meetings={upcomingMeetings}
                    dueTodayTasks={dueTodayTasks}
                    activeTasks={activeTasks}
                    personalSession={personalSession}
                    currentRoutine={currentRoutine}
                    nextRoutine={nextRoutine}
                    routineCompletion={routineCompletion}
                    currentStreak={currentStreak}
                    bestStreak={bestStreak}
                    focusMinutesToday={dailyStats.focusMinutes}
                    tasksCompletedToday={dailyStats.tasksCompleted}
                    motivation={dashboardMessage}
                    groupSession={groupSession}
                    selectedGroup={selectedGroup}
                    timerNow={timerNow}
                    onOpenTasks={() => switchView("Tasks")}
                    onOpenMeetings={() => switchView("Meetings")}
                    onOpenRoutine={() => switchView("Routine")}
                    onToggleTask={toggleTask}
                  />
                )}

                {activeView === "Routine" && (
                  <RoutineView
                    routines={sortedRoutines}
                    completedBlocks={dailyStats.routineCompletedBlocks}
                    completion={routineCompletion}
                    routineTitle={routineTitle}
                    routineStart={routineStart}
                    routineEnd={routineEnd}
                    routineDuration={routineDuration}
                    editingRoutineId={editingRoutineId}
                    dataReady={!dataLoading}
                    onRoutineTitleChange={setRoutineTitle}
                    onRoutineStartChange={setRoutineStart}
                    onRoutineEndChange={setRoutineEnd}
                    onRoutineDurationChange={setRoutineDuration}
                    onSubmitRoutine={submitRoutine}
                    onCancelEdit={resetRoutineForm}
                    onEditRoutine={startEditRoutine}
                    onDeleteRoutine={deleteRoutine}
                    onToggleRoutineBlock={updateRoutineChecklist}
                  />
                )}

                {activeView === "Focus Mode" && (
                  <FocusModeView
                    currentRoutine={currentRoutine}
                    nextRoutine={nextRoutine}
                    focusSessionTitle={focusSessionTitle}
                    personalSession={personalSession}
                    personalSessionDuration={personalSessionDuration}
                    groupSession={groupSession}
                    groupSessionDuration={groupSessionDuration}
                    selectedGroup={selectedGroup}
                    timerNow={timerNow}
                    onFocusSessionTitleChange={setFocusSessionTitle}
                    onPersonalSessionDurationChange={setPersonalSessionDuration}
                    onGroupSessionDurationChange={setGroupSessionDuration}
                    onStartPersonalSession={startPersonalSession}
                    onStartGroupSession={startGroupSession}
                    onJoinGroupSession={joinGroupSession}
                  />
                )}

                {activeView === "Tasks" && (
                  <TasksView
                    tasks={filteredTasks}
                    taskFilter={taskFilter}
                    taskTitle={taskTitle}
                    dueDate={dueDate}
                    priority={priority}
                    editingTaskId={editingTaskId}
                    dataReady={!dataLoading}
                    onTaskTitleChange={setTaskTitle}
                    onDueDateChange={setDueDate}
                    onPriorityChange={setPriority}
                    onSubmitTask={submitTask}
                    onCancelEdit={resetTaskForm}
                    onFilterChange={setTaskFilter}
                    onToggleTask={toggleTask}
                    onEditTask={startEditTask}
                    onDeleteTask={deleteTask}
                  />
                )}

                {activeView === "Meetings" && (
                  <MeetingsView
                    meetings={sortedMeetings}
                    meetingTitle={meetingTitle}
                    meetingDate={meetingDate}
                    meetingTime={meetingTime}
                    meetingDuration={meetingDuration}
                    meetingType={meetingType}
                    dataReady={!dataLoading}
                    onMeetingTitleChange={setMeetingTitle}
                    onMeetingDateChange={setMeetingDate}
                    onMeetingTimeChange={setMeetingTime}
                    onMeetingDurationChange={setMeetingDuration}
                    onMeetingTypeChange={setMeetingType}
                    onSubmitMeeting={submitMeeting}
                    onDeleteMeeting={deleteMeeting}
                  />
                )}

                {activeView === "Notes" && (
                  <NotesView note={note} lastSaved={lastSaved} noteCards={noteCards} onNoteChange={updateNote} />
                )}

                {activeView === "Groups" && (
                  <GroupsView
                    groups={groups}
                    groupName={groupName}
                    joinInviteCode={joinInviteCode}
                    groupJoinError={groupJoinError}
                    selectedGroupId={selectedGroupId}
                    groupTaskTitle={groupTaskTitle}
                    groupTasks={groupTasks}
                    dataReady={!dataLoading}
                    onGroupNameChange={setGroupName}
                    onCreateGroup={createGroup}
                    onJoinInviteCodeChange={(value) => {
                      setJoinInviteCode(value.toUpperCase());
                      setGroupJoinError("");
                    }}
                    onJoinGroup={joinGroup}
                    onOpenGroup={openGroupDashboard}
                    onBackToGroups={closeGroupDashboard}
                    onGroupTaskTitleChange={setGroupTaskTitle}
                    onSubmitGroupTask={submitGroupTask}
                    onToggleGroupTask={toggleGroupTask}
                    onDeleteGroupTask={deleteGroupTask}
                  />
                )}

                {activeView === "Profile" && (
                  <ProfileView
                    user={user}
                    totalTasks={tasks.length}
                    completedTasks={completedTasks}
                    totalMeetings={meetings.length}
                    progress={progress}
                    onExportData={exportData}
                    onResetCloudData={resetCloudData}
                    onLogout={logout}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </section>
      </div>
    </main>
  );
}

function DashboardView({
  tasks,
  meetings,
  dueTodayTasks,
  activeTasks,
  personalSession,
  currentRoutine,
  nextRoutine,
  routineCompletion,
  currentStreak,
  bestStreak,
  focusMinutesToday,
  tasksCompletedToday,
  motivation,
  groupSession,
  selectedGroup,
  timerNow,
  onOpenTasks,
  onOpenMeetings,
  onOpenRoutine,
  onToggleTask,
}: {
  tasks: Task[];
  meetings: Meeting[];
  dueTodayTasks: number;
  activeTasks: number;
  personalSession: StudySession | null;
  currentRoutine: RoutineBlock | null;
  nextRoutine: RoutineBlock | null;
  routineCompletion: number;
  currentStreak: number;
  bestStreak: number;
  focusMinutesToday: number;
  tasksCompletedToday: number;
  motivation: string;
  groupSession: StudySession | null;
  selectedGroup: Group | null;
  timerNow: number;
  onOpenTasks: () => void;
  onOpenMeetings: () => void;
  onOpenRoutine: () => void;
  onToggleTask: (id: string) => void;
}) {
  const topTasks = tasks.filter((task) => !task.done).slice(0, 5);
  const firstMeeting = meetings[0];
  const activePersonal = sessionRemainingSeconds(personalSession, timerNow) > 0;
  const activeGroup = sessionRemainingSeconds(groupSession, timerNow) > 0;
  const focusStatus = activePersonal ? personalSession?.title ?? "Personal session" : activeGroup ? `${selectedGroup?.name ?? "Group"} session` : "Ready";

  // Dynamically colour the routine progress bar based on completion percentage.
  // 70% or more = green, 30–69% = yellow, below 30% = red.
  const routineBarClass = useMemo(() => {
    if (routineCompletion >= 70) {
      return "bg-green-400 shadow-[0_0_24px_rgba(74,222,128,0.35)]";
    }
    if (routineCompletion >= 30) {
      return "bg-yellow-400 shadow-[0_0_24px_rgba(250,204,21,0.35)]";
    }
    return "bg-red-400 shadow-[0_0_24px_rgba(248,113,113,0.35)]";
  }, [routineCompletion]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="Current Streak" value={`${currentStreak} day${currentStreak === 1 ? "" : "s"}`} icon={<Trophy />} />
        <Stat title="Focus Today" value={`${focusMinutesToday} min`} icon={<Flame />} />
        <Stat title="Tasks Done" value={tasksCompletedToday.toString()} icon={<CheckCircle2 />} />
        <Stat title="Routine" value={`${routineCompletion}%`} icon={<Timer />} />
      </section>

      <div className="rounded-[1.4rem] border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-sm text-cyan-50">
        {motivation} <span className="text-white/35">Best streak: {bestStreak} day{bestStreak === 1 ? "" : "s"}</span>
      </div>

      <section className="grid gap-6 xl:grid-cols-3">
        <Panel title="Today's Tasks" actionLabel="Open Tasks" onAction={onOpenTasks}>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-3xl font-semibold">{activeTasks}</p>
              <p className="mt-1 text-sm text-white/45">active tasks</p>
              <p className="mt-2 text-xs text-cyan-100">{dueTodayTasks} due today</p>
            </div>
            <div className="space-y-2">
              {topTasks.slice(0, 3).length === 0 && <EmptyState>No active tasks waiting.</EmptyState>}
              {topTasks.slice(0, 3).map((task) => (
                <TaskRow key={task.id} task={task} compact onToggleTask={onToggleTask} />
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Routine Overview" actionLabel="Open Routine" onAction={onOpenRoutine}>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm text-white/45">Current</p>
              <p className="mt-1 text-lg font-semibold">{currentRoutine?.title ?? "No active routine"}</p>
            </div>
            <div>
              <p className="text-sm text-white/45">Next</p>
              <p className="mt-1 text-white/75">
                {nextRoutine ? `${nextRoutine.title} at ${formatRoutineTime(nextRoutine.startMinutes)}` : "No routine scheduled"}
              </p>
            </div>
            <div className="h-3 rounded-full bg-white/10">
              {/* Use the computed routineBarClass to colour the progress bar based on completion percentage */}
              <div
                className={`h-full rounded-full ${routineBarClass}`}
                style={{ width: `${routineCompletion}%` }}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Status" actionLabel="Meetings" onAction={onOpenMeetings}>
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-white/45">Active session</p>
              <p className="mt-1 font-semibold text-cyan-100">{focusStatus}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-white/45">Upcoming meeting</p>
              {firstMeeting ? <MeetingRow meeting={firstMeeting} /> : <p className="mt-1 text-white/65">No meetings scheduled.</p>}
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function TasksView({
  tasks,
  taskFilter,
  taskTitle,
  dueDate,
  priority,
  editingTaskId,
  dataReady,
  onTaskTitleChange,
  onDueDateChange,
  onPriorityChange,
  onSubmitTask,
  onCancelEdit,
  onFilterChange,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: {
  tasks: Task[];
  taskFilter: TaskFilter;
  taskTitle: string;
  dueDate: string;
  priority: Priority;
  editingTaskId: string | null;
  dataReady: boolean;
  onTaskTitleChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
  onPriorityChange: (value: Priority) => void;
  onSubmitTask: () => void;
  onCancelEdit: () => void;
  onFilterChange: (value: TaskFilter) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
      <Panel title={editingTaskId === null ? "Add Task" : "Edit Task"}>
        <div className="mt-4 grid gap-3">
          <input
            value={taskTitle}
            onChange={(event) => onTaskTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitTask();
              }
            }}
            data-testid="task-title-input"
            className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
            placeholder="Add task quickly..."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={dueDate}
              onChange={(event) => onDueDateChange(event.target.value)}
              data-testid="task-due-input"
              aria-label="Task due date"
              inputMode="numeric"
              className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="YYYY-MM-DD"
            />

            <select
              value={priority}
              onChange={(event) => onPriorityChange(event.target.value as Priority)}
              data-testid="priority-select"
              aria-label="Task priority"
              className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-sm outline-none"
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSubmitTask}
              data-testid="add-task-button"
              disabled={!dataReady}
              className="flex-1 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(103,232,249,0.35)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {editingTaskId === null ? "Add Task" : "Save Task"}
            </button>
            {editingTaskId !== null && (
              <button type="button" onClick={onCancelEdit} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 transition hover:bg-white/10">
                Cancel
              </button>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Task Manager">
        <div className="mt-4 flex flex-wrap gap-2">
          {(["All", "Active", "Completed"] as TaskFilter[]).map((filter) => (
            <button
              type="button"
              key={filter}
              onClick={() => onFilterChange(filter)}
              className={`rounded-full px-4 py-2 text-sm transition ${
                taskFilter === filter ? "bg-cyan-300 text-black" : "border border-white/10 text-white/65 hover:bg-white/10"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {tasks.length === 0 && <EmptyState>No tasks in this filter.</EmptyState>}
          <AnimatePresence initial={false}>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggleTask={onToggleTask}
                onEditTask={onEditTask}
                onDeleteTask={onDeleteTask}
              />
            ))}
          </AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}

function MeetingsView({
  meetings,
  meetingTitle,
  meetingDate,
  meetingTime,
  meetingDuration,
  meetingType,
  dataReady,
  onMeetingTitleChange,
  onMeetingDateChange,
  onMeetingTimeChange,
  onMeetingDurationChange,
  onMeetingTypeChange,
  onSubmitMeeting,
  onDeleteMeeting,
}: {
  meetings: Meeting[];
  meetingTitle: string;
  meetingDate: string;
  meetingTime: string;
  meetingDuration: string;
  meetingType: string;
  dataReady: boolean;
  onMeetingTitleChange: (value: string) => void;
  onMeetingDateChange: (value: string) => void;
  onMeetingTimeChange: (value: string) => void;
  onMeetingDurationChange: (value: string) => void;
  onMeetingTypeChange: (value: string) => void;
  onSubmitMeeting: () => void;
  onDeleteMeeting: (id: string) => void;
}) {
  const previewMeetingStart = parseMeetingStart(meetingTime);
  const previewMeetingEnd =
    previewMeetingStart === null ? null : previewMeetingStart + normalizeMeetingDuration(meetingDuration);

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
      <Panel title="Add Meeting">
        <div className="mt-4 grid gap-3">
          <input
            value={meetingTitle}
            onChange={(event) => onMeetingTitleChange(event.target.value)}
            data-testid="meeting-title-input"
            className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
            placeholder="Meeting title"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={meetingDate}
              onChange={(event) => onMeetingDateChange(event.target.value)}
              data-testid="meeting-date-input"
              aria-label="Meeting date"
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="YYYY-MM-DD"
            />
            <input
              value={meetingTime}
              onChange={(event) => onMeetingTimeChange(event.target.value)}
              data-testid="meeting-time-input"
              aria-label="Meeting time"
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="Start time, e.g. 4:30 PM"
            />
            <input
              value={meetingDuration}
              onChange={(event) => onMeetingDurationChange(event.target.value)}
              data-testid="meeting-duration-input"
              aria-label="Meeting duration in minutes"
              inputMode="numeric"
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="Duration minutes"
            />
          </div>

          <input
            value={meetingType}
            onChange={(event) => onMeetingTypeChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitMeeting();
              }
            }}
            data-testid="meeting-type-input"
            className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
            placeholder="Type"
          />

          {previewMeetingStart !== null && previewMeetingEnd !== null && (
            <p className="rounded-2xl border border-cyan-300/15 bg-cyan-300/10 px-4 py-3 text-xs text-cyan-100">
              Ends at {formatClockTime(previewMeetingEnd)}
            </p>
          )}

          <button
            type="button"
            onClick={onSubmitMeeting}
            data-testid="add-meeting-button"
            disabled={!dataReady}
            className="rounded-2xl bg-purple-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(216,180,254,0.28)] transition hover:bg-purple-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Add Meeting
          </button>
        </div>
      </Panel>

      <Panel title="Upcoming Meetings">
        <div className="mt-4 space-y-3">
          {meetings.length === 0 && <EmptyState>No meetings scheduled.</EmptyState>}
          <AnimatePresence initial={false}>
            {meetings.map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} onDeleteMeeting={onDeleteMeeting} />
            ))}
          </AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}

function NotesView({
  note,
  lastSaved,
  noteCards,
  onNoteChange,
}: {
  note: string;
  lastSaved: string;
  noteCards: string[];
  onNoteChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <Panel title="Brain Dump">
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          data-testid="brain-dump"
          className="mt-4 min-h-[28rem] w-full resize-none rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 outline-none placeholder:text-white/35"
          placeholder="Capture ideas, unfinished thoughts, reminders..."
        />
        <p className="mt-3 text-xs text-white/40">Last saved: {lastSaved}</p>
      </Panel>

      <Panel title="Quick Note Cards">
        <div className="mt-4 space-y-3">
          {noteCards.length === 0 && <EmptyState>Your first non-empty note line becomes a card.</EmptyState>}
          {noteCards.map((card, index) => (
            <div key={`${card}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/70">
              {card}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function GroupsView({
  groups,
  groupName,
  joinInviteCode,
  groupJoinError,
  selectedGroupId,
  groupTaskTitle,
  groupTasks,
  dataReady,
  onGroupNameChange,
  onCreateGroup,
  onJoinInviteCodeChange,
  onJoinGroup,
  onOpenGroup,
  onBackToGroups,
  onGroupTaskTitleChange,
  onSubmitGroupTask,
  onToggleGroupTask,
  onDeleteGroupTask,
}: {
  groups: Group[];
  groupName: string;
  joinInviteCode: string;
  groupJoinError: string;
  selectedGroupId: string | null;
  groupTaskTitle: string;
  groupTasks: GroupTask[];
  dataReady: boolean;
  onGroupNameChange: (value: string) => void;
  onCreateGroup: () => void;
  onJoinInviteCodeChange: (value: string) => void;
  onJoinGroup: () => void;
  onOpenGroup: (id: string) => void;
  onBackToGroups: () => void;
  onGroupTaskTitleChange: (value: string) => void;
  onSubmitGroupTask: () => void;
  onToggleGroupTask: (id: string) => void;
  onDeleteGroupTask: (id: string) => void;
}) {
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

  if (selectedGroup) {
    return (
      <GroupDashboard
        group={selectedGroup}
        groupTaskTitle={groupTaskTitle}
        groupTasks={groupTasks}
        dataReady={dataReady}
        onGroupTaskTitleChange={onGroupTaskTitleChange}
        onSubmitGroupTask={onSubmitGroupTask}
        onToggleGroupTask={onToggleGroupTask}
        onDeleteGroupTask={onDeleteGroupTask}
        onBack={onBackToGroups}
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-6">
        <Panel title="Create Group">
          <div className="mt-4 grid gap-3">
            <input
              value={groupName}
              onChange={(event) => onGroupNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCreateGroup();
                }
              }}
              data-testid="group-name-input"
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="Group name"
            />

            <button
              type="button"
              onClick={onCreateGroup}
              data-testid="create-group-button"
              disabled={!dataReady || !groupName.trim()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(103,232,249,0.35)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <UsersRound size={17} /> Create Group
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-100">
            New groups generate an invite code like ORB-7KQ2 and add you as the first member.
          </div>
        </Panel>

        <Panel title="Join Group">
          <div className="mt-4 grid gap-3">
            <input
              value={joinInviteCode}
              onChange={(event) => onJoinInviteCodeChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onJoinGroup();
                }
              }}
              data-testid="join-code-input"
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-white/35"
              placeholder="Enter invite code"
            />

            {groupJoinError && (
              <div className="rounded-2xl border border-red-300/25 bg-red-400/10 p-3 text-sm text-red-100">{groupJoinError}</div>
            )}

            <button
              type="button"
              onClick={onJoinGroup}
              data-testid="join-group-button"
              disabled={!dataReady || !joinInviteCode.trim()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-purple-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(216,180,254,0.28)] transition hover:bg-purple-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <UsersRound size={17} /> Join Group
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Your Groups">
        <div className="mt-4 space-y-3">
          {groups.length === 0 && <EmptyState>No groups yet. Create one or join with an invite code.</EmptyState>}
          <AnimatePresence initial={false}>
            {groups.map((group) => (
              <GroupRow key={group.id} group={group} onOpenGroup={onOpenGroup} />
            ))}
          </AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}

function RoutineView({
  routines,
  completedBlocks,
  completion,
  routineTitle,
  routineStart,
  routineEnd,
  routineDuration,
  editingRoutineId,
  dataReady,
  onRoutineTitleChange,
  onRoutineStartChange,
  onRoutineEndChange,
  onRoutineDurationChange,
  onSubmitRoutine,
  onCancelEdit,
  onEditRoutine,
  onDeleteRoutine,
  onToggleRoutineBlock,
}: {
  routines: RoutineBlock[];
  completedBlocks: string[];
  completion: number;
  routineTitle: string;
  routineStart: string;
  routineEnd: string;
  routineDuration: StudyDuration;
  editingRoutineId: string | null;
  dataReady: boolean;
  onRoutineTitleChange: (value: string) => void;
  onRoutineStartChange: (value: string) => void;
  onRoutineEndChange: (value: string) => void;
  onRoutineDurationChange: (value: StudyDuration) => void;
  onSubmitRoutine: () => void;
  onCancelEdit: () => void;
  onEditRoutine: (routine: RoutineBlock) => void;
  onDeleteRoutine: (id: string) => void;
  onToggleRoutineBlock: (routineId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title={editingRoutineId === null ? "Create Routine" : "Edit Routine"}>
          <div className="mt-4 grid gap-3">
            <input
              value={routineTitle}
              onChange={(event) => onRoutineTitleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitRoutine();
                }
              }}
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="Routine title"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="time"
                value={routineStart}
                onChange={(event) => onRoutineStartChange(event.target.value)}
                aria-label="Routine start time"
                className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none"
              />
              <input
                type="time"
                value={routineEnd}
                onChange={(event) => onRoutineEndChange(event.target.value)}
                aria-label="Routine end time"
                className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([25, 50, 90] as StudyDuration[]).map((duration) => (
                <button
                  type="button"
                  key={duration}
                  onClick={() => onRoutineDurationChange(duration)}
                  className={`rounded-2xl border px-4 py-3 text-sm transition ${
                    routineDuration === duration ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100" : "border-white/10 text-white/65 hover:bg-white/10"
                  }`}
                >
                  {duration} min
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSubmitRoutine}
                disabled={!dataReady || !routineTitle.trim()}
                className="flex-1 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(103,232,249,0.35)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {editingRoutineId === null ? "Create Routine" : "Save Routine"}
              </button>
              {editingRoutineId !== null && (
                <button type="button" onClick={onCancelEdit} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 transition hover:bg-white/10">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </Panel>

        <RoutineChecklistPanel
          routines={routines}
          completedBlocks={completedBlocks}
          completion={completion}
          onToggleRoutineBlock={onToggleRoutineBlock}
        />
      </section>

      <Panel title="Routine Timeline">
        <div className="mt-5 space-y-3">
          {routines.length === 0 && <EmptyState>No routines yet. Create your first block to build the day.</EmptyState>}
          <AnimatePresence initial={false}>
            {routines.map((routine) => {
              const completed = completedBlocks.includes(routine.id) || completedBlocks.includes(routine.title);
              return (
                <motion.div
                  key={routine.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 18 }}
                  transition={{ duration: 0.16 }}
                  className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:-translate-y-0.5 hover:bg-white/10 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-white/90">{routine.title}</p>
                      {completed && <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-xs text-cyan-100">Done today</span>}
                    </div>
                    <p className="mt-1 text-sm text-white/45">
                      {formatRoutineTime(routine.startMinutes)} - {formatRoutineTime(routine.endMinutes)} - {routine.defaultDuration} min focus default
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => onEditRoutine(routine)} className="rounded-xl border border-white/10 p-2 text-white/45 transition hover:text-cyan-200">
                      <Edit3 size={17} />
                    </button>
                    <button type="button" onClick={() => onDeleteRoutine(routine.id)} className="rounded-xl border border-white/10 p-2 text-white/35 transition hover:text-red-300">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}

function FocusModeView({
  currentRoutine,
  nextRoutine,
  focusSessionTitle,
  personalSession,
  personalSessionDuration,
  groupSession,
  groupSessionDuration,
  selectedGroup,
  timerNow,
  onFocusSessionTitleChange,
  onPersonalSessionDurationChange,
  onGroupSessionDurationChange,
  onStartPersonalSession,
  onStartGroupSession,
  onJoinGroupSession,
}: {
  currentRoutine: RoutineBlock | null;
  nextRoutine: RoutineBlock | null;
  focusSessionTitle: string;
  personalSession: StudySession | null;
  personalSessionDuration: StudyDuration;
  groupSession: StudySession | null;
  groupSessionDuration: StudyDuration;
  selectedGroup: Group | null;
  timerNow: number;
  onFocusSessionTitleChange: (value: string) => void;
  onPersonalSessionDurationChange: (value: StudyDuration) => void;
  onGroupSessionDurationChange: (value: StudyDuration) => void;
  onStartPersonalSession: (routine?: RoutineBlock, manualTitle?: string, durationOverride?: StudyDuration) => void;
  onStartGroupSession: (routine?: RoutineBlock, manualTitle?: string, durationOverride?: StudyDuration) => void;
  onJoinGroupSession: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="Current Routine" value={currentRoutine?.title ?? "None"} icon={<Timer />} />
        <Stat title="Next Routine" value={nextRoutine ? formatRoutineTime(nextRoutine.startMinutes) : "None"} icon={<Clock3 />} />
        <Stat title="Personal" value={sessionRemainingSeconds(personalSession, timerNow) > 0 ? "Active" : "Ready"} icon={<Flame />} />
        <Stat title="Group" value={selectedGroup?.name ?? "None"} icon={<UsersRound />} />
      </section>

      <StudySessionPanel
        title="Personal Focus"
        session={personalSession}
        duration={personalSessionDuration}
        currentRoutine={currentRoutine}
        nextRoutine={nextRoutine}
        manualTitle={focusSessionTitle}
        timerNow={timerNow}
        startLabel={currentRoutine ? "Start Session" : "Start Study Session"}
        onManualTitleChange={onFocusSessionTitleChange}
        onDurationChange={onPersonalSessionDurationChange}
        onStart={onStartPersonalSession}
      />

      {selectedGroup ? (
        <StudySessionPanel
          title={`Group Focus - ${selectedGroup.name}`}
          session={groupSession}
          duration={groupSessionDuration}
          currentRoutine={currentRoutine}
          nextRoutine={nextRoutine}
          manualTitle={focusSessionTitle}
          timerNow={timerNow}
          startLabel={currentRoutine ? "Start Session" : "Start Group Session"}
          onManualTitleChange={onFocusSessionTitleChange}
          onDurationChange={onGroupSessionDurationChange}
          onStart={onStartGroupSession}
          onJoinSession={onJoinGroupSession}
          showGroupDetails
        />
      ) : (
        <Panel title="Group Focus">
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/55">
            Open a group from the Groups section to start or join a synced group study session.
          </div>
        </Panel>
      )}
    </div>
  );
}

function RoutineChecklistPanel({
  routines,
  completedBlocks,
  completion,
  onToggleRoutineBlock,
}: {
  routines: RoutineBlock[];
  completedBlocks: string[];
  completion: number;
  onToggleRoutineBlock: (routineId: string) => void;
}) {
  return (
    <Panel title="Routine Checklist">
      <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
          <p className="text-4xl font-semibold">{completion}%</p>
          <p className="mt-2 text-sm text-white/45">Complete at least 70% to count the daily streak.</p>
          <div className="mt-5 h-3 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-cyan-300 shadow-[0_0_24px_rgba(103,232,249,0.35)]" style={{ width: `${completion}%` }} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {routines.length === 0 && <EmptyState>No checklist items yet.</EmptyState>}
          {routines.map((routine) => {
            const completed = completedBlocks.includes(routine.id) || completedBlocks.includes(routine.title);
            return (
              <button
                type="button"
                key={routine.id}
                onClick={() => onToggleRoutineBlock(routine.id)}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/10 ${
                  completed ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-black/20"
                }`}
              >
                {completed ? <CheckCircle2 className="mt-0.5 shrink-0 text-cyan-300" /> : <Circle className="mt-0.5 shrink-0 text-white/35" />}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white/85">{routine.title}</span>
                  <span className="mt-1 block text-xs text-white/45">
                    {formatRoutineTime(routine.startMinutes)} - {formatRoutineTime(routine.endMinutes)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function StudySessionPanel({
  title,
  session,
  duration,
  currentRoutine,
  nextRoutine,
  manualTitle,
  timerNow,
  startLabel,
  showGroupDetails = false,
  onManualTitleChange,
  onDurationChange,
  onStart,
  onJoinSession,
}: {
  title: string;
  session: StudySession | null;
  duration: StudyDuration;
  currentRoutine: RoutineBlock | null;
  nextRoutine: RoutineBlock | null;
  manualTitle: string;
  timerNow: number;
  startLabel: string;
  showGroupDetails?: boolean;
  onManualTitleChange: (value: string) => void;
  onDurationChange: (value: StudyDuration) => void;
  onStart: (routine?: RoutineBlock, manualTitle?: string, durationOverride?: StudyDuration) => void;
  onJoinSession?: () => void;
}) {
  const remainingSeconds = sessionRemainingSeconds(session, timerNow);
  const active = Boolean(session && remainingSeconds > 0);
  const completed = Boolean(session && remainingSeconds === 0);
  const progress = sessionProgress(session, timerNow);
  const selectedTitle = currentRoutine?.title ?? manualTitle.trim();
  const canStart = !active && Boolean(currentRoutine || selectedTitle);
  const startDuration = duration;

  return (
    <Panel title={title}>
      <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3">
          <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">Current Routine</p>
            <p className="mt-2 text-lg font-semibold text-white/85">{currentRoutine?.title ?? "No active routine"}</p>
            <p className="mt-1 text-sm text-white/45">
              {currentRoutine
                ? `${formatRoutineTime(currentRoutine.startMinutes)} - ${formatRoutineTime(currentRoutine.endMinutes)}`
                : "Quick start appears during a routine block."}
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-white/30">Next Routine</p>
              <p className="mt-1 text-sm text-white/65">
                {nextRoutine ? `${nextRoutine.title} at ${formatRoutineTime(nextRoutine.startMinutes)}` : "No routine scheduled"}
              </p>
            </div>
          </div>

          {!currentRoutine && (
            <input
              value={manualTitle}
              onChange={(event) => onManualTitleChange(event.target.value)}
              data-testid="focus-session-title-input"
              className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="Session title"
            />
          )}

          <div className="grid grid-cols-3 gap-2">
            {([25, 50, 90] as StudyDuration[]).map((option) => (
              <button
                type="button"
                key={option}
                onClick={() => onDurationChange(option)}
                disabled={active}
                className={`rounded-2xl border px-4 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  duration === option ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100" : "border-white/10 text-white/65 hover:bg-white/10"
                }`}
              >
                {option} min
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onStart(currentRoutine ?? undefined, manualTitle, startDuration)}
            disabled={!canStart}
            className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(103,232,249,0.35)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {active ? "Session Active" : startLabel}
          </button>

          {showGroupDetails && active && onJoinSession && (
            <button
              type="button"
              onClick={onJoinSession}
              className="w-full rounded-2xl border border-purple-300/20 px-4 py-3 text-sm text-purple-100 transition hover:bg-purple-300/10"
            >
              Join Existing Session
            </button>
          )}
        </div>

        <div className="rounded-[1.7rem] border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`rounded-full px-3 py-1 text-xs ${active ? "bg-cyan-300/15 text-cyan-100" : completed ? "bg-emerald-300/15 text-emerald-100" : "bg-white/10 text-white/45"}`}>
              {active ? "Session Active" : completed ? "Session completed" : "Ready"}
            </span>
            <span className="text-xs text-white/40">{session ? `${session.durationMinutes} minute session` : `${duration} minute option`}</span>
          </div>

          {session && <p className="mt-4 text-sm font-medium text-cyan-100">{session.title}</p>}
          <p className="mt-5 font-mono text-6xl font-semibold tracking-normal text-white md:text-7xl">
            {session ? formatTimer(remainingSeconds) : formatTimer(duration * 60)}
          </p>

          <div className="mt-5 h-3 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-cyan-300 shadow-[0_0_24px_rgba(103,232,249,0.35)]" style={{ width: `${session ? progress : 0}%` }} />
          </div>

          {session && (
            <div className="mt-4 grid gap-2 text-sm text-white/55">
              <p>Started by {session.startedByName}</p>
              {showGroupDetails && (
                <p>
                  {session.participantIds.length} member{session.participantIds.length === 1 ? "" : "s"} studying
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ProfileView({
  user,
  totalTasks,
  completedTasks,
  totalMeetings,
  progress,
  onExportData,
  onResetCloudData,
  onLogout,
}: {
  user: AppUser;
  totalTasks: number;
  completedTasks: number;
  totalMeetings: number;
  progress: number;
  onExportData: () => void;
  onResetCloudData: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <Panel title={user.displayName ?? "Srujan"}>
        <div className="mt-4 space-y-4">
          <ProfileLine label="Name" value={user.displayName ?? "Srujan"} />
          <ProfileLine label="Email" value={user.email ?? "No email from Google"} />
          <ProfileLine label="App" value="Orbitex" />
          <ProfileLine label="Goal" value="Personal productivity command center" />
          <ProfileLine label="Theme" value="Dark premium" />
        </div>
      </Panel>

      <Panel title="Cloud Stats">
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stat title="Total Tasks" value={totalTasks.toString()} icon={<CheckCircle2 />} />
          <Stat title="Completed" value={completedTasks.toString()} icon={<Flame />} />
          <Stat title="Meetings" value={totalMeetings.toString()} icon={<CalendarDays />} />
          <Stat title="Productivity" value={`${progress}%`} icon={<Clock3 />} />
        </section>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button type="button" onClick={onExportData} className="flex items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black transition hover:bg-cyan-200">
            <Download size={16} /> Export Data
          </button>
          <button type="button" onClick={onResetCloudData} className="flex items-center justify-center gap-2 rounded-2xl border border-red-300/20 px-4 py-3 text-sm text-red-100 transition hover:bg-red-400/10">
            <RotateCcw size={16} /> Reset Cloud Data
          </button>
          <button type="button" disabled className="rounded-2xl border border-emerald-300/20 px-4 py-3 text-sm text-emerald-100">
            Firebase Sync Active
          </button>
          <button type="button" onClick={onLogout} className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 transition hover:bg-white/10">
            <LogOut size={16} /> Logout
          </button>
        </div>
      </Panel>
    </div>
  );
}

function GroupDashboard({
  group,
  groupTaskTitle,
  groupTasks,
  dataReady,
  onGroupTaskTitleChange,
  onSubmitGroupTask,
  onToggleGroupTask,
  onDeleteGroupTask,
  onBack,
}: {
  group: Group;
  groupTaskTitle: string;
  groupTasks: GroupTask[];
  dataReady: boolean;
  onGroupTaskTitleChange: (value: string) => void;
  onSubmitGroupTask: () => void;
  onToggleGroupTask: (id: string) => void;
  onDeleteGroupTask: (id: string) => void;
  onBack: () => void;
}) {
  const creator = group.memberProfiles.find((member) => member.id === group.creatorId) ?? group.memberProfiles[0];
  const currentWeek = weekKey();
  const leaderboard = parseLeaderboard(group.leaderboard, group.memberProfiles).map((entry) =>
    entry.weekKey === currentWeek
      ? entry
      : {
          ...entry,
          weekKey: currentWeek,
          focusMinutes: 0,
          completedGroupTasks: 0,
        },
  );
  const focusLeaders = [...leaderboard].sort((first, second) => second.focusMinutes - first.focusMinutes).slice(0, 5);
  const taskLeaders = [...leaderboard].sort((first, second) => second.completedGroupTasks - first.completedGroupTasks).slice(0, 5);

  return (
    <div className="space-y-6">
      <Panel title={group.name} actionLabel="Back to Groups" onAction={onBack}>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Stat title="Invite Code" value={group.inviteCode} icon={<UsersRound />} />
          <Stat title="Members" value={group.members.length.toString()} icon={<User />} />
          <Stat title="Created By" value={creator?.name ?? "Orbitex user"} icon={<ShieldCheck />} />
        </div>
      </Panel>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Add Group Task">
          <div className="mt-4 grid gap-3">
            <input
              value={groupTaskTitle}
              onChange={(event) => onGroupTaskTitleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitGroupTask();
                }
              }}
              data-testid="group-task-title-input"
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-white/35"
              placeholder="Add shared group task..."
            />

            <button
              type="button"
              onClick={onSubmitGroupTask}
              data-testid="add-group-task-button"
              disabled={!dataReady || !groupTaskTitle.trim()}
              className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(103,232,249,0.35)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Add Group Task
            </button>
          </div>
        </Panel>

        <Panel title="Shared Tasks">
          <div className="mt-4 space-y-3">
            {groupTasks.length === 0 && <EmptyState>No shared tasks yet.</EmptyState>}
            <AnimatePresence initial={false}>
              {groupTasks.map((task) => (
                <GroupTaskRow key={task.id} task={task} onToggleTask={onToggleGroupTask} onDeleteTask={onDeleteGroupTask} />
              ))}
            </AnimatePresence>
          </div>
        </Panel>
      </section>

      <Panel title="Group Leaderboard">
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <LeaderboardList title="Weekly Focus" entries={focusLeaders} metric="focusMinutes" />
          <LeaderboardList title="Group Tasks" entries={taskLeaders} metric="completedGroupTasks" />
        </div>
      </Panel>

      <Panel title="Members">
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {group.memberProfiles.length === 0 && <EmptyState>No member profiles yet.</EmptyState>}
          {group.memberProfiles.map((member) => (
            <div key={member.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="truncate font-medium text-white/85">{member.name}</p>
              <p className="mt-1 truncate text-xs text-white/40">{member.email || member.id}</p>
              <span className="mt-3 inline-flex rounded-full bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">{member.role}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function LeaderboardList({
  title,
  entries,
  metric,
}: {
  title: string;
  entries: GroupLeaderboardEntry[];
  metric: "focusMinutes" | "completedGroupTasks";
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/75">
        <Trophy size={16} className="text-cyan-300" />
        {title}
      </div>

      <div className="space-y-2">
        {entries.length === 0 && <EmptyState>No leaderboard activity yet.</EmptyState>}
        {entries.map((entry, index) => (
          <div key={entry.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white/85">
                #{index + 1} {entry.name}
              </p>
              <p className="mt-1 text-xs text-white/35">This week</p>
            </div>
            <span className="shrink-0 rounded-full bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100">
              {metric === "focusMinutes" ? `${entry.focusMinutes} min` : `${entry.completedGroupTasks} tasks`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupRow({ group, onOpenGroup }: { group: Group; onOpenGroup: (id: string) => void }) {
  const creator = group.memberProfiles.find((member) => member.id === group.creatorId) ?? group.memberProfiles[0];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.16 }}
      className="rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:-translate-y-0.5 hover:bg-white/10"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{group.name}</p>
          <p className="mt-1 text-sm text-white/45">
            {group.members.length} member{group.members.length === 1 ? "" : "s"}
            {creator ? ` - Created by ${creator.name}` : ""}
          </p>
        </div>

        <div className="shrink-0 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 font-mono text-sm text-cyan-100">
          {group.inviteCode}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {group.memberProfiles.map((member) => (
          <span key={member.id} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/60">
            {member.name} - {member.role}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onOpenGroup(group.id)}
        className="mt-4 w-full rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 transition hover:bg-white/10 hover:text-white sm:w-auto"
      >
        Open Group
      </button>
    </motion.div>
  );
}

function GroupTaskRow({
  task,
  onToggleTask,
  onDeleteTask,
}: {
  task: GroupTask;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.16 }}
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:-translate-y-0.5 hover:bg-white/10"
    >
      <button
        type="button"
        aria-label={task.done ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
        onClick={() => onToggleTask(task.id)}
        className="shrink-0"
      >
        {task.done ? <CheckCircle2 className="text-cyan-300" /> : <Circle className="text-white/35" />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`${task.done ? "text-white/35 line-through" : "text-white"} truncate font-medium`}>{task.title}</p>
        <p className="mt-1 text-xs text-white/40">Added by {task.createdByName}</p>
        {task.done && task.completedByName && (
          <p className="mt-1 text-xs text-cyan-100">Completed by {task.completedByName}</p>
        )}
      </div>

      <button type="button" aria-label={`Delete group task ${task.title}`} onClick={() => onDeleteTask(task.id)} className="shrink-0 text-white/30 transition hover:text-red-300">
        <Trash2 size={18} />
      </button>
    </motion.div>
  );
}

function TaskRow({
  task,
  compact = false,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: {
  task: Task;
  compact?: boolean;
  onToggleTask: (id: string) => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (id: string) => void;
}) {
  const overdue = isOverdue(task);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={`group flex items-center gap-3 rounded-2xl border bg-black/20 p-4 transition hover:-translate-y-0.5 hover:bg-white/10 ${
        overdue ? "border-red-400/60 shadow-[0_0_24px_rgba(248,113,113,0.16)]" : "border-white/10"
      }`}
    >
      <button
        type="button"
        aria-label={task.done ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
        onClick={() => onToggleTask(task.id)}
      >
        {task.done ? <CheckCircle2 className="text-cyan-300" /> : <Circle className={overdue ? "text-red-300" : "text-white/35"} />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`${task.done ? "text-white/35 line-through" : "text-white"} truncate font-medium`}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={overdue ? "text-red-200" : "text-white/40"}>Due: {task.due}</span>
          {overdue && <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-red-200">Overdue</span>}
          {task.carriedOver && <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-100">Carried over</span>}
        </div>
      </div>

      <span className={`rounded-full px-3 py-1 text-xs ${priorityBadgeClass[task.priority]}`}>{task.priority}</span>

      {!compact && onEditTask && (
        <button type="button" aria-label={`Edit ${task.title}`} onClick={() => onEditTask(task)} className="text-white/35 transition hover:text-cyan-200">
          <Edit3 size={17} />
        </button>
      )}

      {!compact && onDeleteTask && (
        <button type="button" aria-label={`Delete ${task.title}`} onClick={() => onDeleteTask(task.id)} className="text-white/30 transition hover:text-red-300">
          <Trash2 size={18} />
        </button>
      )}
    </motion.div>
  );
}

function MeetingRow({ meeting, onDeleteMeeting }: { meeting: Meeting; onDeleteMeeting?: (id: string) => void }) {
  const meetingStart = parseMeetingStart(meeting.time);
  const meetingEnd = meetingStart === null ? null : meetingStart + normalizeMeetingDuration(meeting.duration);
  const meetingTimeRange = meetingStart === null || meetingEnd === null ? meeting.time : `${formatClockTime(meetingStart)} - ${formatClockTime(meetingEnd)}`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.16 }}
      className="rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:-translate-y-0.5 hover:bg-white/10"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{meeting.title}</p>
          <p className="mt-1 text-xs text-white/40">
            {meeting.date} - {meeting.type}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-cyan-200">{meetingTimeRange}</span>
          {onDeleteMeeting && (
            <button type="button" aria-label={`Delete meeting ${meeting.title}`} onClick={() => onDeleteMeeting(meeting.id)} className="text-white/30 transition hover:text-red-300">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Panel({
  title,
  children,
  actionLabel,
  onAction,
}: {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-2xl">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xl font-semibold">{title}</h3>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55 transition hover:bg-white/10 hover:text-white">
            {actionLabel}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    // Animate stat cards on mount and gently scale on hover for a polished feel.
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-[1.7rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-2xl"
    >
      <div className="flex items-center justify-between text-white/45">
        {title}
        <span className="text-cyan-200">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold">{value}</p>
    </motion.div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/45">{children}</div>;
}

function ProfileLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-2 break-words text-white/80">{value}</p>
    </div>
  );
}

function ShellBackground({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#080A12] p-5 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(70,120,255,0.25),transparent_34%),radial-gradient(circle_at_top_right,rgba(150,80,255,0.18),transparent_30%)]" />
      <div className="relative z-10 w-full max-w-xl">{children}</div>
    </main>
  );
}

function LoginCard({
  title,
  subtitle,
  error,
  onSignIn,
}: {
  title: string;
  subtitle: string;
  error?: string;
  onSignIn?: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-2xl"
    >
      <p className="text-xs uppercase tracking-[0.4em] text-cyan-300">Orbitex</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-white/60">{subtitle}</p>
      {error && <div className="mt-5 rounded-2xl border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100">{error}</div>}
      {onSignIn && (
        <button
          type="button"
          onClick={onSignIn}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_0_25px_rgba(103,232,249,0.35)] transition hover:bg-cyan-200"
        >
          <User size={17} /> Sign in with Google
        </button>
      )}
    </motion.section>
  );
}

function LoadingScreen({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-[2rem] border border-white/10 bg-white/[0.06] p-8 text-center shadow-2xl backdrop-blur-2xl ${compact ? "min-h-64" : ""}`}>
      <div className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
      <p className="mt-4 text-sm text-white/60">{label}</p>
    </div>
  );
}
