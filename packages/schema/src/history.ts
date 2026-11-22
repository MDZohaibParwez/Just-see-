import { applyCommand, describeCommand, type Command } from "./commands";
import type { Project } from "./model";

export interface HistoryEntry {
  command: Command;
  inverse: Command;
  label: string;
  at: number;
}

export interface HistoryState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

/** Undo depth kept in memory. Older steps live on in version history. */
export const MAX_HISTORY = 500;

export function createHistory(project: Project): HistoryState {
  return { project, past: [], future: [] };
}

/** Run a command and record it. Throws CommandError if invalid. */
export function execute(state: HistoryState, command: Command, now = Date.now()): HistoryState {
  const result = applyCommand(state.project, command, { now });
  if (!result.changed) return state;
  const entry: HistoryEntry = { command, inverse: result.inverse, label: describeCommand(command), at: now };
  const past = [...state.past, entry];
  if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
  return { project: result.project, past, future: [] };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

export function undo(state: HistoryState, now = Date.now()): HistoryState {
  const entry = state.past[state.past.length - 1];
  if (!entry) return state;
  const result = applyCommand(state.project, entry.inverse, { now });
  // Redoing replays the original command; store the fresh inverse for the next undo.
  return {
    project: result.project,
    past: state.past.slice(0, -1),
    future: [{ ...entry, inverse: result.inverse }, ...state.future],
  };
}

export function redo(state: HistoryState, now = Date.now()): HistoryState {
  const entry = state.future[0];
  if (!entry) return state;
  const result = applyCommand(state.project, entry.command, { now });
  return {
    project: result.project,
    past: [...state.past, { ...entry, inverse: result.inverse }],
    future: state.future.slice(1),
  };
}
