import { describe, expect, it } from "vitest";
import { orderedCategories, searchClips } from "./clipsSearch";

describe("searchClips direct jump", () => {
  it("opens the producer page for a matricule", () => {
    expect(searchClips("GDNA-CLIPS-B-0045")).toMatchObject({ kind: "matricule", path: "clips/B/GDNA-CLIPS-B-0045" });
    expect(searchClips("gdna-clips-b-45")).toMatchObject({ path: "clips/B/GDNA-CLIPS-B-0045" });
    expect(searchClips("c-7")).toMatchObject({ path: "clips/C/GDNA-CLIPS-C-0007" });
  });
  it("opens a library for a letter or keyword", () => {
    expect(searchClips("A")).toMatchObject({ kind: "library", path: "clips/A" });
    expect(searchClips("خريطة")).toMatchObject({ path: "clips/D" });
    expect(searchClips("Ads")).toMatchObject({ path: "clips/C" });
    expect(searchClips("إشهار")).toMatchObject({ path: "clips/C" });
  });
  it("opens a HELX code and filters by type", () => {
    expect(searchClips("HELX-000123")).toMatchObject({ kind: "code", path: "clip/HELX-000123" });
    expect(searchClips("صورة")).toMatchObject({ kind: "filter", type: "image" });
  });
  it("falls back to text search", () => {
    expect(searchClips("chaussures rouges")).toEqual({ kind: "text", text: "chaussures rouges" });
  });
  it("orders most-watched category first", () => {
    expect(orderedCategories({ last: {}, counts: { C: 5, A: 1 } })).toEqual(["C", "A", "B", "D"]);
  });
});
