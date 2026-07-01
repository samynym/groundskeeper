import { describe, it, expect } from "vitest";
import type { ContentSource } from "./index.js";

describe("ContentSource interface", () => {
  it("is a type-only module that compiles", () => {
    const noop = (_cs: ContentSource) => true;
    expect(typeof noop).toBe("function");
  });
});
