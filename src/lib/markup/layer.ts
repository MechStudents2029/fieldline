import { z } from "zod";

export const MARKUP_COLORS = ["teal", "red", "yellow", "black", "white"] as const;
export const MARKUP_TOOLS = ["pen", "arrow", "rect", "ellipse", "text"] as const;

export const MARKUP_COLOR_HEX: Record<(typeof MARKUP_COLORS)[number], string> = {
  teal: "#0f766e",
  red: "#dc2626",
  yellow: "#eab308",
  black: "#111111",
  white: "#ffffff",
};

const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const markupShapeSchema = z.object({
  id: z.string().min(1).max(40),
  tool: z.enum(MARKUP_TOOLS),
  color: z.enum(MARKUP_COLORS),
  points: z.array(pointSchema).min(1).max(500),
  text: z.string().max(80).optional(),
});

export const markupLayerSchema = z.object({
  shapes: z.array(markupShapeSchema).max(80),
});

export type MarkupColor = (typeof MARKUP_COLORS)[number];
export type MarkupTool = (typeof MARKUP_TOOLS)[number];
export type MarkupShape = z.infer<typeof markupShapeSchema>;
export type MarkupLayer = z.infer<typeof markupLayerSchema>;

export function parseMarkupLayer(value: unknown): MarkupLayer | null {
  const parsed = markupLayerSchema.safeParse(value);
  if (!parsed.success) return null;
  for (const shape of parsed.data.shapes) {
    if (shape.tool === "text" && !shape.text?.trim()) return null;
    if ((shape.tool === "arrow" || shape.tool === "rect" || shape.tool === "ellipse") && shape.points.length < 2) return null;
  }
  return parsed.data;
}

export function emptyMarkupLayer(): MarkupLayer {
  return { shapes: [] };
}
