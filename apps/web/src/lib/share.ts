"use client";

import { createId, type Project } from "@just-see/schema";
import { apiJson, uploadFile } from "./api";
import { backupBlob } from "./backup";

/** Upload a copy of the project and return a link anyone can open. */
export async function shareCopy(project: Project, onProgress?: (p: number) => void): Promise<string> {
  const blob = await backupBlob(project, (d, t) => onProgress?.((d / Math.max(1, t)) * 0.3));
  const url = await uploadFile(`shares/${createId("s_")}.justsee`, new File([blob], `${project.name}.justsee`, { type: "application/zip" }), (p) => onProgress?.(0.3 + p * 0.7));
  const { link } = await apiJson<{ link: string }>("/api/share", { method: "POST", body: JSON.stringify({ url, name: project.name }) });
  return link;
}
