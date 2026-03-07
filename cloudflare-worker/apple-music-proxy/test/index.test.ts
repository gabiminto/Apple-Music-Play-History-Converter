import { describe, expect, it } from "vitest";
import { normalizeStorefront, parseIsrcCodes, sanitizeLimit, shouldRequireProxyKey } from "../src/index";

describe("worker helpers", () => {
  it("normalizes storefront and defaults to us", () => {
    expect(normalizeStorefront("GB")).toBe("gb");
    expect(normalizeStorefront("  ")).toBe("us");
  });

  it("sanitizes search limit boundaries", () => {
    expect(sanitizeLimit("0")).toBe(1);
    expect(sanitizeLimit("100")).toBe(25);
    expect(sanitizeLimit("7")).toBe(7);
    expect(sanitizeLimit(undefined)).toBe(5);
  });

  it("parses and deduplicates ISRC code list", () => {
    expect(parseIsrcCodes(" usrc17607839,USRC17607839, gbum71604677 ")).toEqual([
      "USRC17607839",
      "GBUM71604677",
    ]);
  });

  it("requires proxy key only when configured", () => {
    expect(shouldRequireProxyKey("")).toBe(false);
    expect(shouldRequireProxyKey("abc123")).toBe(true);
  });
});
