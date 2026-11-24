/**
 * Small UI stores for the full-screen editors. Kept apart from the screens so
 * the editor can open a screen without loading its code up front.
 */
import { create } from "zustand";
import type { LibKind } from "@/lib/library";

export const useStudioUi = create<{ openId: string | null; open(id: string | null): void }>((set) => ({
  openId: null,
  open: (openId) => set({ openId }),
}));

export const useMotionUi = create<{ openId: string | null; open(id: string | null): void }>((set) => ({ openId: null, open: (openId) => set({ openId }) }));

export type LibraryTab = LibKind | "all" | "online" | "licenses";
export const useLibraryUi = create<{ open: boolean; tab: LibraryTab; show(tab?: LibraryTab): void; hide(): void }>((set) => ({
  open: false,
  tab: "all",
  show: (tab = "all") => set({ open: true, tab }),
  hide: () => set({ open: false }),
}));
