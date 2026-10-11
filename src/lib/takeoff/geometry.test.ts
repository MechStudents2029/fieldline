import { describe, expect, it } from "vitest";
import {
  formatFeetInches,
  inchesPerPart,
  measureQuantity,
  parseFeetInches,
  pitchFactor,
  polygonArea,
  polylineLength,
  snapPoint,
  type Scale,
} from "@/lib/takeoff/geometry";

const segment: Scale = {
  mode: "segment",
  ax: 0,
  ay: 50_000,
  bx: 10_000,
  by: 50_000,
  realInches: 120,
  aspectBps: 10_000,
};

describe("takeoff geometry", () => {
  it("measures a horizontal length from a two-point scale", () => {
    expect(inchesPerPart(segment)).toBeCloseTo(0.012);
    const qty = measureQuantity({
      kind: "linear",
      points: [
        { x: 10_000, y: 40_000 },
        { x: 40_000, y: 40_000 },
      ],
      scale: segment,
    });
    expect(qty).toEqual({ qtyMilli: 30_000, unit: "lf" });
  });

  it("uses aspect on a vertical run and sums a polyline", () => {
    const aspect = 20_000;
    const length = polylineLength(
      [
        { x: 0, y: 0 },
        { x: 0, y: 10_000 },
        { x: 10_000, y: 10_000 },
      ],
      aspect,
    );
    expect(length).toBeCloseTo(30_000);
  });

  it("computes polygon area with the shoelace formula", () => {
    expect(
      polygonArea(
        [
          { x: 0, y: 0 },
          { x: 10_000, y: 0 },
          { x: 10_000, y: 10_000 },
          { x: 0, y: 10_000 },
        ],
        10_000,
      ),
    ).toBeCloseTo(100_000_000);
    const qty = measureQuantity({
      kind: "area",
      points: [
        { x: 0, y: 0 },
        { x: 10_000, y: 0 },
        { x: 10_000, y: 10_000 },
        { x: 0, y: 10_000 },
      ],
      scale: segment,
    });
    expect(qty).toEqual({ qtyMilli: 100_000, unit: "sf" });
  });

  it("turns wall height, pitch, and depth into area or yards", () => {
    const wall = measureQuantity({
      kind: "wall",
      points: [
        { x: 10_000, y: 10_000 },
        { x: 20_000, y: 10_000 },
      ],
      scale: segment,
      heightInches: 96,
    });
    expect(wall).toEqual({ qtyMilli: 80_000, unit: "sf" });
    expect(pitchFactor(6, 12)).toBeCloseTo(Math.sqrt(5) / 2);
    const pitched = measureQuantity({
      kind: "area",
      points: [
        { x: 0, y: 0 },
        { x: 10_000, y: 0 },
        { x: 10_000, y: 10_000 },
      ],
      scale: segment,
      pitchRise: 6,
      pitchRun: 12,
    });
    expect(pitched.unit).toBe("sf");
    expect(pitched.qtyMilli).toBe(Math.round(((100 / 2) * (Math.sqrt(5) / 2)) * 1000));
    const yards = measureQuantity({
      kind: "area",
      points: [
        { x: 0, y: 0 },
        { x: 10_000, y: 0 },
        { x: 10_000, y: 10_000 },
        { x: 0, y: 10_000 },
      ],
      scale: segment,
      depthInches: 4,
    });
    expect(yards.unit).toBe("cy");
    expect(yards.qtyMilli).toBe(Math.round(((14_400 * 4) / 46_656) * 1000));
  });

  it("counts markers and reads a standard scale", () => {
    expect(
      measureQuantity({
        kind: "count",
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
        scale: segment,
      }),
    ).toEqual({ qtyMilli: 3_000, unit: "ea" });
    const preset: Scale = { mode: "preset", preset: "arch-1-4", paperWidthInches: 36, aspectBps: 10_000 };
    const qty = measureQuantity({
      kind: "wall",
      points: [
        { x: 10_000, y: 10_000 },
        { x: 20_000, y: 10_000 },
      ],
      scale: preset,
      heightInches: 96,
    });
    expect(qty.qtyMilli).toBe(115_200);
  });

  it("parses feet and inches and snaps to a nearby vertex", () => {
    expect(parseFeetInches("10'6\"")).toBe(126);
    expect(parseFeetInches("10' 6\"")).toBe(126);
    expect(parseFeetInches("10-6")).toBe(126);
    expect(parseFeetInches("10'")).toBe(120);
    expect(parseFeetInches('6"')).toBe(6);
    expect(parseFeetInches("10")).toBe(120);
    expect(formatFeetInches(126)).toBe("10' 6\"");
    expect(snapPoint({ x: 100, y: 80 }, [{ x: 0, y: 0 }], 50)).toEqual({ x: 100, y: 80 });
    expect(snapPoint({ x: 100, y: 80 }, [{ x: 120, y: 90 }], 50)).toEqual({ x: 120, y: 90 });
  });
});
