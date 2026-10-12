import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADIUS_M,
  describePunch,
  evaluateSite,
  formatDistance,
  haversineMeters,
  metersToUnit,
  siteColumn,
  sitePill,
  sketchLayout,
  unitToMeters,
} from "@/lib/geo/fence";
import { GEOCODER_ENABLED, geocodeAddress } from "@/lib/geo/geocoder";

const PIN = { pinLatE6: 37_799_400, pinLngE6: -122_247_000, radiusM: null as number | null, defaultRadiusM: DEFAULT_RADIUS_M };

describe("job-site fence", () => {
  it("measures a degree of latitude and a zero move", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    const degree = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(degree).toBeGreaterThan(111_000);
    expect(degree).toBeLessThan(111_400);
  });

  it("formats feet as miles once the distance is a tenth of a mile", () => {
    expect(formatDistance(644, "ft")).toBe("0.4 mi");
    expect(formatDistance(30, "ft")).toBe("98 ft");
    expect(formatDistance(1500, "m")).toBe("1.5 km");
    expect(formatDistance(300, "m")).toBe("300 m");
    expect(sitePill("outside", 644, "ft")).toBe("Outside 0.4 mi");
    expect(metersToUnit(300, "ft")).toBe(984);
    expect(unitToMeters(1000, "ft")).toBe(305);
  });

  it("keeps a point inside, and flags one past the radius", () => {
    const inside = evaluateSite({
      mode: "warn",
      userRequiresLocation: false,
      projectId: "job",
      shiftType: "regular",
      ...PIN,
      latE6: 37_799_400,
      lngE6: -122_247_000,
      accuracyM: 8,
    });
    expect(inside.verdict).toBe("inside");
    expect(inside.distanceM).toBe(0);
    expect(inside.flagged).toBe(false);

    const outside = evaluateSite({
      mode: "warn",
      userRequiresLocation: false,
      projectId: "job",
      shiftType: "regular",
      ...PIN,
      latE6: 37_805_180,
      lngE6: -122_247_000,
      accuracyM: 8,
    });
    expect(outside.verdict).toBe("outside");
    expect(outside.flagged).toBe(true);
    expect(sitePill(outside.verdict, outside.distanceM, "ft")).toBe("Outside 0.4 mi");
  });

  it("does not call a missing pin, a missing point, weak GPS, general time, or an off company a false outside", () => {
    const base = {
      mode: "warn" as const,
      userRequiresLocation: false,
      projectId: "job",
      shiftType: "regular",
      ...PIN,
      latE6: 37_805_180,
      lngE6: -122_247_000,
      accuracyM: 8,
    };
    expect(evaluateSite({ ...base, pinLatE6: null, pinLngE6: null, latE6: null, lngE6: null }).verdict).toBe("no_pin");
    expect(evaluateSite({ ...base, pinLatE6: null, pinLngE6: null }).flagged).toBe(false);
    expect(evaluateSite({ ...base, latE6: null, lngE6: null }).verdict).toBe("missing");
    expect(evaluateSite({ ...base, accuracyM: 500 }).verdict).toBe("weak");
    expect(evaluateSite({ ...base, accuracyM: 500, latE6: 37_799_400 }).verdict).toBe("weak");
    expect(evaluateSite({ ...base, projectId: "", shiftType: "regular" }).verdict).toBe("skip");
    for (const shiftType of ["pto", "holiday", "sick", "training"]) {
      expect(evaluateSite({ ...base, shiftType }).verdict).toBe("skip");
      expect(evaluateSite({ ...base, shiftType }).flagged).toBe(false);
    }
    expect(evaluateSite({ ...base, mode: "off" }).verdict).toBe("off");
    expect(evaluateSite({ ...base, mode: "off", userRequiresLocation: true }).verdict).toBe("outside");
    expect(evaluateSite({ ...base, radiusM: 50_000 }).verdict).toBe("inside");
  });

  it("shows the farther outside edge and keeps an override beside it", () => {
    const described = describePunch({
      inVerdict: "inside",
      outVerdict: "outside",
      inDistanceM: 12,
      outDistanceM: 644,
      unit: "ft",
      overridden: true,
    });
    expect(described.pill).toBe("Outside 0.4 mi");
    expect(described.overridden).toBe(true);
    expect(siteColumn(described.pill, true)).toBe("Outside 0.4 mi · Overridden");
    expect(siteColumn(null, false)).toBe("");
    expect(describePunch({ inVerdict: "no_pin", outVerdict: "inside", inDistanceM: null, outDistanceM: 0, unit: "ft", overridden: false }).pill).toBe("No pin");
  });

  it("places a north point above the pin", () => {
    const layout = sketchLayout({ lat: 37.7994, lng: -122.247 }, 300, [{ lat: 37.802, lng: -122.247, kind: "in" }]);
    expect(layout.dots[0]?.y).toBeLessThan(layout.cy);
    expect(layout.r).toBeGreaterThan(0);
  });

  it("leaves address geocoding off", async () => {
    expect(GEOCODER_ENABLED).toBe(false);
    expect(await geocodeAddress("1200 Oak Street, Oakland")).toBeNull();
  });
});
