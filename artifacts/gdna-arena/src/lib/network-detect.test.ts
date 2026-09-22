import { describe, expect, it } from "vitest";
import { getAutoLiteReferral } from "./network-detect";

describe("operator referral Lite opt-in", () => {
  it.each(["inwi", "orange", "itissalat", "*6", "star6"])(
    "accepts the allow-listed %s referral",
    (ref) => expect(getAutoLiteReferral(`?ref=${encodeURIComponent(ref)}`)).toBe(ref),
  );

  it("accepts decoded star-six and normalizes harmless casing", () => {
    expect(getAutoLiteReferral("?ref=%2A6")).toBe("*6");
    expect(getAutoLiteReferral("?ref=Orange")).toBe("orange");
  });

  it.each([
    "?ref=labelpackverified",
    "?ref=unknown-network",
    "?ref=https%3A%2F%2Fevil.example",
    "?ref=%2F%2Fevil.example",
    "?other=inwi",
    "",
  ])("ignores unknown or absent referral input: %s", (search) => {
    expect(getAutoLiteReferral(search)).toBeNull();
  });
});