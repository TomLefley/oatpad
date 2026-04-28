import { describe, it, expect } from "vitest";
import { assignUniqueIds } from "./noteIds";

function makeIdFactory() {
  let n = 0;
  return () => `new-${++n}`;
}

describe("assignUniqueIds", () => {
  it("preserves existing unique ids", () => {
    const out = assignUniqueIds(["a", "b", "c"], makeIdFactory());
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("assigns fresh ids to blocks missing one", () => {
    const out = assignUniqueIds(["a", null, "c"], makeIdFactory());
    expect(out).toEqual(["a", "new-1", "c"]);
  });

  it("reassigns duplicate ids, keeping the first occurrence", () => {
    const out = assignUniqueIds(["x", "x", "x", "y"], makeIdFactory());
    expect(out).toEqual(["x", "new-1", "new-2", "y"]);
  });

  it("handles mix of duplicates and missing", () => {
    const out = assignUniqueIds(["x", null, "x", null], makeIdFactory());
    expect(out).toEqual(["x", "new-1", "new-2", "new-3"]);
  });
});
