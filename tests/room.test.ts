import { describe, expect, it } from "vitest";
import { createIsometricRoom } from "../src/room.js";

const options = {
  width: 1000, depth: 600, canvas: { width: 2304, height: 1296 }, padding: 100,
  objects: [{ id: "table", x: 400, z: 240, width: 180, depth: 100, height: 90 }]
};

describe("original 2.5D room projection", () => {
  it("moves both world axes across an angled floor while keeping height vertical", () => {
    const room = createIsometricRoom(options);
    const root = room.project({ x: 200, z: 200 });
    const x = room.project({ x: 300, z: 200 });
    const z = room.project({ x: 200, z: 300 });
    expect(x.x).toBeGreaterThan(root.x);
    expect(z.x).toBeLessThan(root.x);
    expect(x.y).toBe(root.y + 50);
    expect(z.y).toBe(root.y + 50);
    const jump = room.project({ x: 200, z: 200 }, 40);
    expect(jump.x).toBe(root.x);
    expect(jump.y).toBe(root.y - 40);
  });

  it("round-trips floor/elevated anchors without confusing projected Y with world Z", () => {
    const room = createIsometricRoom(options);
    for (const point of [{ x: 0, z: 0 }, { x: 1000, z: 600 }, { x: 123.45, z: 321.9 }]) {
      for (const height of [0, 50, 123]) {
        const result = room.unproject(room.project(point, height), height);
        expect(result.x).toBeCloseTo(point.x, 10);
        expect(result.z).toBeCloseTo(point.z, 10);
      }
    }
  });

  it("checks room bounds and genuine obstacle footprints with a body radius", () => {
    const room = createIsometricRoom(options);
    expect(room.canOccupy({ x: 200, z: 200 }, 12)).toBe(true);
    expect(room.canOccupy({ x: 450, z: 270 }, 12)).toBe(false);
    expect(room.canOccupy({ x: 390, z: 270 }, 12)).toBe(false);
    expect(room.canOccupy({ x: 380, z: 270 }, 12)).toBe(true);
    expect(room.canOccupy({ x: 5, z: 200 }, 12)).toBe(false);
    expect(room.depthAt({ x: 300, z: 300 })).toBeGreaterThan(room.depthAt({ x: 100, z: 100 }));
  });

  it("rejects malformed/failing camera layouts rather than clipping silently", () => {
    expect(() => createIsometricRoom({ ...options, unitScale: 0 })).toThrow();
    expect(() => createIsometricRoom({ ...options, canvas: { width: 640, height: 400 } })).toThrow(/fit/);
    expect(() => createIsometricRoom({ ...options, objects: [...options.objects, ...options.objects] })).toThrow(/unique/);
    expect(() => createIsometricRoom({ ...options, objects: [{ ...options.objects[0]!, x: 990 }] })).toThrow(/inside/);
    expect(() => createIsometricRoom({ ...options, objects: [{ ...options.objects[0]!, height: 2000 }] })).toThrow(/headroom/);
    const room = createIsometricRoom(options);
    expect(() => room.project({ x: NaN, z: 0 })).toThrow(/finite/);
    expect(() => room.contains({ x: 1, z: 1 }, -1)).toThrow();
  });
});
