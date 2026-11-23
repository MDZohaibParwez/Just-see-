import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, "fixtures");

export function ensureFixtures(): void {
  if (!fs.existsSync(path.join(FIXTURES, "clip5.mp4")) || !fs.existsSync(path.join(FIXTURES, "photo.png")) || !fs.existsSync(path.join(FIXTURES, "greenscreen.mp4")) || !fs.existsSync(path.join(FIXTURES, "gap.mp3")) || !fs.existsSync(path.join(FIXTURES, "noisy-voice.mp4")) || !fs.existsSync(path.join(FIXTURES, "shaky.mp4"))) {
    execFileSync("bash", [path.join(HERE, "make-fixtures.sh")], { stdio: "inherit" });
  }
}

export function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

export async function newProject(page: Page, aspect = "9:16"): Promise<void> {
  await page.goto("/");
  await page.getByTestId(`new-${aspect}`).click();
  await expect(page).toHaveURL(/\/edit\/\?id=/);
  await expect(page.getByTestId("timeline")).toBeVisible();
}

export async function mainClipCount(page: Page): Promise<number> {
  return page.getByTestId("track-main").getByTestId("timeline-clip").count();
}

export function ffprobe(file: string): {
  streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_frames?: string; duration?: string }[];
  format: { duration: string };
} {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).toString();
  return JSON.parse(out);
}

/** Decode one frame at `t` seconds as raw RGB24 scaled to w×h. */
export function frameRgb(file: string, t: number, w: number, h: number): Buffer {
  return execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

export function meanAbsDiff(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / n;
}

export function meanLuma(a: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) sum += 0.2126 * a[i]! + 0.7152 * a[i + 1]! + 0.0722 * a[i + 2]!;
  return sum / (a.length / 3);
}
