// vibe-player-v2/src/lib/utils/formatters.test.ts
import { describe, it, expect } from "vitest";
import { formatTime } from "./formatters";

describe("formatTime", () => {
  it("should format 0 seconds correctly", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("should format less than 1 minute correctly", () => {
    expect(formatTime(30)).toBe("0:30");
    expect(formatTime(59)).toBe("0:59");
  });

  it("should format exactly 1 minute correctly", () => {
    expect(formatTime(60)).toBe("1:00");
  });

  it("should format more than 1 minute correctly", () => {
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(125)).toBe("2:05");
  });

  it("should format large numbers of seconds correctly", () => {
    expect(formatTime(3600)).toBe("60:00"); // 1 hour
    expect(formatTime(3661)).toBe("61:01");
  });

  it('should handle NaN by returning "0:00"', () => {
    expect(formatTime(NaN)).toBe("0:00");
  });

  it('should handle negative numbers by returning "0:00"', () => {
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(-0.5)).toBe("0:00");
  });

  it("should handle decimal seconds by flooring them", () => {
    expect(formatTime(30.5)).toBe("0:30");
    expect(formatTime(59.999)).toBe("0:59");
    expect(formatTime(60.1)).toBe("1:00");
  });
});
