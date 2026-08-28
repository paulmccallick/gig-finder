import { describe, expect, test } from "bun:test";
import { nearestPageOffset } from "../../client/ScoutPositionReview";

describe("Scout position review pagination", () => {
  test("keeps a valid offset and repairs an empty final page", () => {
    expect(nearestPageOffset(39, 20, 20)).toBe(20);
    expect(nearestPageOffset(20, 20, 20)).toBe(0);
    expect(nearestPageOffset(0, 20, 20)).toBe(0);
  });

  test("rejects invalid pagination inputs", () => {
    expect(() => nearestPageOffset(-1, 0, 20)).toThrow();
    expect(() => nearestPageOffset(1, -1, 20)).toThrow();
    expect(() => nearestPageOffset(1, 0, 0)).toThrow();
  });
});
