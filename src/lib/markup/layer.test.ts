import { describe, expect, it } from "vitest";
import { parseMarkupLayer } from "@/lib/markup/layer";

describe("markup layer", () => {
  it("keeps a pen, an arrow, and text in the fixed colors", () => {
    const layer = parseMarkupLayer({
      shapes: [
        { id: "s1", tool: "pen", color: "teal", points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }] },
        { id: "s2", tool: "arrow", color: "red", points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.4 }] },
        { id: "s3", tool: "text", color: "black", points: [{ x: 0.3, y: 0.3 }], text: "Curb" },
      ],
    });
    expect(layer?.shapes).toHaveLength(3);
  });

  it("rejects a color outside the set and a shape that is short", () => {
    expect(parseMarkupLayer({ shapes: [{ id: "s1", tool: "rect", color: "blue", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] })).toBeNull();
    expect(parseMarkupLayer({ shapes: [{ id: "s1", tool: "ellipse", color: "yellow", points: [{ x: 0.2, y: 0.2 }] }] })).toBeNull();
    expect(parseMarkupLayer({ shapes: [{ id: "s1", tool: "text", color: "white", points: [{ x: 0.2, y: 0.2 }], text: "  " }] })).toBeNull();
  });
});
