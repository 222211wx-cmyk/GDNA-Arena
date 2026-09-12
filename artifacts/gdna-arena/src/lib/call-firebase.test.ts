import { describe, expect, it } from "vitest";
import { parseMissedCall } from "./call-firebase";

describe("parseMissedCall", () => {
  it("normalizes an actual Firestore Timestamp-like value to an ISO time", () => {
    const timestamp = { toMillis: () => 1_700_000_000_000 };
    expect(parseMissedCall("call_1", {
      caller: { id: 42, name: "ليلى", avatar: null },
      type: "voice",
      time: timestamp,
      isSeen: false,
      status: "missed",
    })).toEqual({
      id: "call_1",
      caller: { id: 42, name: "ليلى", avatar: null },
      type: "voice",
      time: "2023-11-14T22:13:20.000Z",
      isSeen: false,
      status: "missed",
    });
  });

  it("accepts Timestamp toDate values and rejects malformed Firestore data", () => {
    expect(parseMissedCall("call_2", {
      caller: { id: 3, name: "Omar", avatar: "https://example.test/a.png" },
      type: "video",
      time: { toDate: () => new Date("2025-01-01T00:00:00.000Z") },
      isSeen: true,
      status: "declined",
    })?.time).toBe("2025-01-01T00:00:00.000Z");

    expect(parseMissedCall("call_3", {
      caller: { id: "not-a-number", name: "Omar" },
      type: "video",
      time: { toMillis: () => 1 },
      isSeen: true,
      status: "declined",
    })).toBeNull();
    expect(parseMissedCall("bad/id", {
      caller: { id: 3, name: "Omar" },
      type: "video",
      time: { toMillis: () => 1 },
      isSeen: true,
      status: "declined",
    })).toBeNull();
  });
});