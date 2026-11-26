import { z } from "zod";

/** Shared primitive schemas (kept separate to avoid import cycles). */
export const IdSchema = z.string().min(1).max(64);
export const MicrosSchema = z.number().int().nonnegative();


export const EffectInstanceSchema = z.object({
  id: IdSchema,
  type: z.string().min(1).max(64),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
  /** Asset used by the effect (e.g. a LUT file). */
  assetId: IdSchema.nullable().optional(),
});
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;
