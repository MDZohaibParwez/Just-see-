"use client";

/**
 * Live team editing without a server: phones and laptops connect directly
 * (WebRTC through PeerJS; the free PeerJS broker only introduces them).
 * Every edit is a command, so we send commands, not whole projects.
 * The host keeps the master copy, puts edits in order and sends media.
 */
import { create } from "zustand";
import { createId, parseProject, type Command, type Project } from "@just-see/schema";
import { onLocalCommand, useEditor } from "./editor-store";
import { getMedia, putMedia } from "./storage/media-store";
import { saveProject } from "./storage/db";
import { invalidateAsset } from "./media";
import { track } from "./telemetry";

type DataConnection = import("peerjs").DataConnection;
type PeerT = import("peerjs").Peer;

type Msg =
  | { t: "hello"; name: string }
  | { t: "snapshot"; project: Project; hash: string }
  | { t: "cmd"; cmd: Command; from: string }
  | { t: "need"; assetIds: string[] }
  | { t: "media"; assetId: string; i: number; n: number; mime: string; data: ArrayBuffer }
  | { t: "hash"; hash: string }
  | { t: "resync" }
  | { t: "peers"; names: string[] };

export interface LiveState {
  role: "off" | "host" | "guest";
  room: string;
  status: "idle" | "connecting" | "live" | "error" | "closed";
  error: string;
  peers: string[];
  /** Media files still on their way. */
  pendingMedia: number;
}

export const useLive = create<LiveState>(() => ({ role: "off", room: "", status: "idle", error: "", peers: [], pendingMedia: 0 }));

const CHUNK = 192 * 1024;
const PREFIX = "justsee-";

let peer: PeerT | null = null;
let conns: DataConnection[] = [];
let unsub: (() => void) | null = null;
let hashTimer: number | null = null;
let applyingRemote = false;
const names = new WeakMap<DataConnection, string>();
const incoming = new Map<string, { n: number; parts: ArrayBuffer[]; mime: string }>();
const myName = () => {
  try {
    return localStorage.getItem("justsee:name") || "Editor";
  } catch {
    return "Editor";
  }
};

/** Broker settings: free PeerJS cloud by default; ?peer=host:port for a self-hosted one (and tests). */
function peerOptions(): Record<string, unknown> {
  let custom: string | null = null;
  try {
    custom = new URLSearchParams(location.search).get("peer") ?? sessionStorage.getItem("justsee:peer");
    if (custom) sessionStorage.setItem("justsee:peer", custom);
  } catch {
    // ignore
  }
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(":");
  return { host, port: Number(port ?? 9000), path: "/", secure: location.protocol === "https:" && host !== "localhost" && host !== "127.0.0.1", debug: 0 };
}

/** Small, stable hash of the project to detect when someone fell out of step. */
export function projectHash(p: Project): string {
  const s = JSON.stringify({ a: p.assets.map((a) => a.id), s: p.sequences, m: p.motionComps, f: p.fonts, au: p.audioSessions, n: p.name });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const project = () => useEditor.getState().history?.project ?? null;

function send(c: DataConnection, m: Msg): void {
  if (c.open) c.send(m);
}
function broadcast(m: Msg, except?: DataConnection): void {
  for (const c of conns) if (c !== except) send(c, m);
}

async function sendMedia(c: DataConnection, assetIds: string[]): Promise<void> {
  const p = project();
  for (const id of assetIds) {
    const a = p?.assets.find((x) => x.id === id);
    if (!a) continue;
    const blob = await getMedia(a.storageKey);
    if (!blob) continue;
    const buf = await blob.arrayBuffer();
    const n = Math.max(1, Math.ceil(buf.byteLength / CHUNK));
    for (let i = 0; i < n; i++) {
      send(c, { t: "media", assetId: id, i, n, mime: a.mimeType, data: buf.slice(i * CHUNK, (i + 1) * CHUNK) });
      // Let the data channel drain.
      if (i % 16 === 15) await new Promise((r) => setTimeout(r, 0));
    }
  }
}

async function missingMedia(p: Project): Promise<string[]> {
  const out: string[] = [];
  for (const a of p.assets) if (!(await getMedia(a.storageKey))) out.push(a.id);
  return out;
}

async function onMedia(m: Extract<Msg, { t: "media" }>, from: DataConnection): Promise<void> {
  let e = incoming.get(m.assetId);
  if (!e) {
    e = { n: m.n, parts: new Array<ArrayBuffer>(m.n), mime: m.mime };
    incoming.set(m.assetId, e);
  }
  e.parts[m.i] = m.data;
  if (e.parts.filter(Boolean).length < e.n) return;
  incoming.delete(m.assetId);
  const a = project()?.assets.find((x) => x.id === m.assetId);
  const key = a?.storageKey ?? `media/${m.assetId}`;
  await putMedia(key, new Blob(e.parts, { type: e.mime }));
  invalidateAsset(m.assetId);
  window.dispatchEvent(new CustomEvent("justsee:media", { detail: m.assetId }));
  useLive.setState((s) => ({ pendingMedia: Math.max(0, s.pendingMedia - 1) }));
  // Host passes new media on to the others who may not have it yet.
  if (useLive.getState().role === "host") for (const c of conns) if (c !== from) void sendMedia(c, [m.assetId]);
  // Nudge the preview to redraw with the real pixels.
  const p = project();
  if (p) useEditor.getState().replaceProject({ ...p });
}

function applyFromPeer(cmd: Command): boolean {
  applyingRemote = true;
  try {
    return useEditor.getState().applyRemote(cmd);
  } finally {
    applyingRemote = false;
  }
}

function assetsAdded(cmd: Command): string[] {
  if (cmd.type === "asset/add") return [cmd.payload.asset.id];
  if (cmd.type === "batch") return cmd.payload.commands.flatMap(assetsAdded);
  return [];
}

function wireLocal(): void {
  unsub?.();
  unsub = onLocalCommand((cmd) => {
    if (applyingRemote || useLive.getState().status !== "live") return;
    const msg: Msg = { t: "cmd", cmd, from: myName() };
    broadcast(msg);
    // Media for new assets follows the command.
    const ids = assetsAdded(cmd);
    if (ids.length) for (const c of conns) void sendMedia(c, ids);
  });
}

function onHostMessage(c: DataConnection, m: Msg): void {
  switch (m.t) {
    case "hello": {
      names.set(c, m.name.slice(0, 40));
      const p = project();
      if (p) send(c, { t: "snapshot", project: p, hash: projectHash(p) });
      useLive.setState({ peers: conns.filter((x) => x.open).map((x) => names.get(x) ?? "Guest") });
      for (const x of conns) send(x, { t: "peers", names: [`${myName()} (host)`, ...conns.filter((y) => y !== x).map((y) => names.get(y) ?? "Guest")] });
      break;
    }
    case "cmd": {
      if (applyFromPeer(m.cmd)) broadcast(m, c);
      else {
        const p = project();
        if (p) send(c, { t: "snapshot", project: p, hash: projectHash(p) });
      }
      break;
    }
    case "need":
      void sendMedia(c, m.assetIds);
      break;
    case "media":
      void onMedia(m, c);
      break;
    case "resync": {
      const p = project();
      if (p) send(c, { t: "snapshot", project: p, hash: projectHash(p) });
      break;
    }
    default:
      break;
  }
}

async function onGuestMessage(c: DataConnection, m: Msg): Promise<void> {
  switch (m.t) {
    case "snapshot": {
      const p = parseProject(m.project);
      const had = project();
      if (had && had.id === p.id) useEditor.getState().replaceProject(p);
      else useEditor.getState().load(p);
      await saveProject(p);
      void import("./fonts").then((f) => f.ensureProjectFonts(p));
      const need = await missingMedia(p);
      useLive.setState({ status: "live", pendingMedia: need.length });
      if (need.length) send(c, { t: "need", assetIds: need });
      break;
    }
    case "cmd":
      if (!applyFromPeer(m.cmd)) send(c, { t: "resync" });
      else {
        const ids = assetsAdded(m.cmd);
        if (ids.length) {
          const p = project();
          const need = p ? (await missingMedia(p)).filter((x) => ids.includes(x)) : [];
          if (need.length) useLive.setState((s) => ({ pendingMedia: s.pendingMedia + need.length }));
        }
      }
      break;
    case "media":
      await onMedia(m, c);
      break;
    case "hash": {
      const p = project();
      if (p && projectHash(p) !== m.hash) send(c, { t: "resync" });
      break;
    }
    case "peers":
      useLive.setState({ peers: m.names });
      break;
    case "need":
      void sendMedia(c, m.assetIds);
      break;
    default:
      break;
  }
}

async function newPeer(id?: string): Promise<PeerT> {
  const { Peer } = await import("peerjs");
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    const timer = setTimeout(() => reject(new Error("Could not reach the connection service. Check your internet.")), 15000);
    p.on("open", () => {
      clearTimeout(timer);
      resolve(p);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Start hosting the open project. Returns the invite link. */
export async function startHosting(): Promise<string> {
  track("live-host");
  await stopLive();
  const room = createId("").replace(/[^a-z0-9]/gi, "").slice(0, 10).toLowerCase();
  useLive.setState({ role: "host", room, status: "connecting", error: "", peers: [] });
  try {
    peer = await newPeer(PREFIX + room);
  } catch (e) {
    useLive.setState({ status: "error", error: (e as Error).message });
    throw e;
  }
  peer.on("connection", (c) => {
    conns.push(c);
    c.on("data", (d) => onHostMessage(c, d as Msg));
    c.on("close", () => {
      conns = conns.filter((x) => x !== c);
      useLive.setState({ peers: conns.map((x) => names.get(x) ?? "Guest") });
    });
  });
  wireLocal();
  hashTimer = window.setInterval(() => {
    const p = project();
    if (p) broadcast({ t: "hash", hash: projectHash(p) });
  }, 4000);
  useLive.setState({ status: "live" });
  const peerParam = (() => {
    try {
      return sessionStorage.getItem("justsee:peer");
    } catch {
      return null;
    }
  })();
  return `${location.origin}/edit/?live=${room}${peerParam ? `&peer=${encodeURIComponent(peerParam)}` : ""}`;
}

/** Join a live session from an invite link. Resolves when the project has arrived. */
export async function joinLive(room: string): Promise<Project> {
  await stopLive();
  useLive.setState({ role: "guest", room, status: "connecting", error: "", peers: [] });
  peer = await newPeer();
  const c = peer.connect(PREFIX + room, { reliable: true, serialization: "binary" });
  conns = [c];
  wireLocal();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The host is not online. Ask them to keep the project open.")), 20000);
    c.on("open", () => send(c, { t: "hello", name: myName() }));
    c.on("data", (d) => {
      const m = d as Msg;
      void onGuestMessage(c, m).then(() => {
        if (m.t === "snapshot") {
          clearTimeout(timer);
          const p = project();
          if (p) resolve(p);
        }
      });
    });
    c.on("close", () => useLive.setState({ status: "closed" }));
    c.on("error", (e) => {
      clearTimeout(timer);
      useLive.setState({ status: "error", error: String(e) });
      reject(e);
    });
  });
}

export async function stopLive(): Promise<void> {
  if (hashTimer) window.clearInterval(hashTimer);
  hashTimer = null;
  unsub?.();
  unsub = null;
  for (const c of conns) c.close();
  conns = [];
  peer?.destroy();
  peer = null;
  useLive.setState({ role: "off", room: "", status: "idle", peers: [], pendingMedia: 0 });
}
