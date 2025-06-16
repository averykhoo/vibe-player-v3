// vibe-player-v2/src/lib/utils/dsp.test.ts
import { describe, expect, it } from "vitest";
import { hannWindow, viridisColor } from "./dsp";

describe("dsp utilities", () => {
  describe("hannWindow", () => {
    it("should return null for invalid lengths", () => {
      expect(hannWindow(0)).toBeNull();
      expect(hannWindow(-5)).toBeNull();
      expect(hannWindow(3.5)).toBeNull();
    });

    it("should return [1] for length 1", () => {
      expect(hannWindow(1)).toEqual([1]);
    });

    it("should generate a correct Hann window for length 4", () => {
      const window = hannWindow(4);
      expect(window).toBeInstanceOf(Array);
      expect(window?.length).toBe(4);
      if (!window) throw new Error("Window is null"); // Type guard
      // Expected values for Hann window of length 4:
      // w[0] = 0.5 * (1 - cos(0)) = 0
      // w[1] = 0.5 * (1 - cos(2*PI*1/3)) = 0.5 * (1 - (-0.5)) = 0.75
      // w[2] = 0.5 * (1 - cos(2*PI*2/3)) = 0.5 * (1 - (-0.5)) = 0.75
      // w[3] = 0.5 * (1 - cos(2*PI*3/3)) = 0.5 * (1 - 1) = 0
      expect(window[0]).toBeCloseTo(0);
      expect(window[1]).toBeCloseTo(0.75);
      expect(window[2]).toBeCloseTo(0.75);
      expect(window[3]).toBeCloseTo(0);
    });

    it("should generate a symmetric Hann window for length 5", () => {
      const window = hannWindow(5);
      expect(window).toBeInstanceOf(Array);
      expect(window?.length).toBe(5);
      if (!window) throw new Error("Window is null");
      // w[0] = 0.5 * (1 - cos(0)) = 0
      // w[1] = 0.5 * (1 - cos(2*PI*1/4)) = 0.5 * (1 - 0) = 0.5
      // w[2] = 0.5 * (1 - cos(2*PI*2/4)) = 0.5 * (1 - (-1)) = 1.0
      // w[3] = 0.5 * (1 - cos(2*PI*3/4)) = 0.5 * (1 - 0) = 0.5
      // w[4] = 0.5 * (1 - cos(2*PI*4/4)) = 0.5 * (1 - 1) = 0
      expect(window[0]).toBeCloseTo(0);
      expect(window[1]).toBeCloseTo(0.5);
      expect(window[2]).toBeCloseTo(1.0);
      expect(window[3]).toBeCloseTo(0.5);
      expect(window[4]).toBeCloseTo(0);
    });

    it("all window values should be between 0 and 1", () => {
      const window = hannWindow(128);
      if (!window) throw new Error("Window is null");
      for (const val of window) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("viridisColor", () => {
    it("should return known color for t = 0 (first color in map)", () => {
      const color = viridisColor(0); // #440154
      expect(color).toEqual([68, 1, 84]);
    });

    it("should return known color for t = 1 (last color in map)", () => {
      const color = viridisColor(1); // #fde725
      expect(color).toEqual([253, 231, 37]);
    });

    it("should return a color for t = 0.5 (interpolated)", () => {
      const color = viridisColor(0.5); // #21918c
      // Exact value from map definition for t=0.5: [31, 155, 137]
      expect(color).toEqual([31, 155, 137]);
    });

    it("should clamp input t < 0 to 0", () => {
      const color = viridisColor(-0.5);
      expect(color).toEqual(viridisColor(0));
    });

    it("should clamp input t > 1 to 1", () => {
      const color = viridisColor(1.5);
      expect(color).toEqual(viridisColor(1));
    });

    it("should return an array of 3 numbers (RGB)", () => {
      const color = viridisColor(0.75);
      expect(color).toBeInstanceOf(Array);
      expect(color.length).toBe(3);
      color.forEach((val) => {
        expect(typeof val).toBe("number");
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(255);
      });
    });
  });
});
