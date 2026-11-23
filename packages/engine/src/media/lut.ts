/** A parsed 3D LUT: RGB triplets, red changing fastest (as in .cube files). */
export interface Lut3D {
  size: number;
  title: string;
  /** size³ × 3 bytes, 0..255. */
  data: Uint8Array;
}

/** Parse an Adobe/Resolve style .cube file (3D LUTs only). */
export function parseCubeLut(text: string): Lut3D {
  let size = 0;
  let title = "";
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0]!.toUpperCase();
    if (key === "TITLE") title = line.slice(5).trim().replace(/^"|"$/g, "");
    else if (key === "LUT_3D_SIZE") size = Number(parts[1]);
    else if (key === "LUT_1D_SIZE") throw new Error("1D LUTs are not supported; use a 3D .cube file");
    else if (key === "DOMAIN_MIN") min = parts.slice(1, 4).map(Number);
    else if (key === "DOMAIN_MAX") max = parts.slice(1, 4).map(Number);
    else if (/^[-+0-9.eE]/.test(parts[0]!)) {
      if (parts.length < 3) throw new Error(`Bad LUT line: ${line}`);
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new Error("Missing or invalid LUT_3D_SIZE");
  if (values.length !== size * size * size * 3) throw new Error(`Expected ${size ** 3} entries, found ${values.length / 3}`);
  const data = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    const v = (values[i]! - min[c]!) / Math.max(1e-6, max[c]! - min[c]!);
    data[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return { size, title, data };
}
