import assert from "node:assert/strict";
import test from "node:test";
import { parseServiceAccount, selectServiceAccount } from "./firebase-service-account.mjs";

const fixture = { project_id: "test-project", client_email: "test@example.invalid", private_key: "test\\nkey\\n" };
for (const [name, raw] of [
  ["raw JSON", JSON.stringify(fixture)],
  ["double stringified", JSON.stringify(JSON.stringify(fixture))],
  ["single quoted", `'${JSON.stringify(fixture)}'`],
  ["shell double quoted", `"${JSON.stringify(fixture)}"`],
  ["pretty JSON", JSON.stringify(fixture, null, 2)],
  ["literal key newlines", JSON.stringify(fixture).replace("test\\\\nkey\\\\n", "test\nkey\n")],
  ["Base64 JSON", Buffer.from(JSON.stringify(fixture)).toString("base64")],
  ["Base64 pretty JSON", Buffer.from(JSON.stringify(fixture, null, 2)).toString("base64")],
  ["unpadded Base64", Buffer.from(JSON.stringify(fixture)).toString("base64").replace(/=+$/, "")],
  ["line-wrapped Base64", Buffer.from(JSON.stringify(fixture)).toString("base64").match(/.{1,40}/g).join("\n")],
  ["quoted Base64", JSON.stringify(Buffer.from(JSON.stringify(fixture)).toString("base64"))],
  ["Base64 double-stringified JSON", Buffer.from(JSON.stringify(JSON.stringify(fixture))).toString("base64")],
]) {
  test(`parses ${name} and normalizes key newlines`, () => {
    const result = parseServiceAccount(raw);
    assert.equal(result.error, null);
    assert.equal(result.account.private_key, "test\nkey\n");
  });
}
test("selects documented keys and spelling alias, skipping empty values", () => {
  assert.equal(selectServiceAccount({ FIREBASE_SERVICE_ACCOUNT: "", FIBERASE_SERVICE_ACCOUNT: "alias" }), "alias");
  assert.equal(selectServiceAccount({ FIREBASE_SERVICE_ACCOUNT: "first", FIREBASE_SERVICE_ACCOUNT_JSON: "second" }), "first");
});
test("rejects malformed Base64, invalid UTF-8, excessive nesting and oversized input safely", () => {
  const encoded = Buffer.from(JSON.stringify(fixture)).toString("base64");
  const inputs = [
    `!${encoded}`, encoded + "=", "A", "AB==",
    Buffer.from([0xff, 0xfe]).toString("base64"),
    Buffer.from("sensitive-not-json").toString("base64"),
    Buffer.from("{}").toString("base64"),
    Buffer.from(encoded).toString("base64"),
    JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(fixture)))))),
    "sensitive".repeat(20000),
  ];
  for (const input of inputs) {
    const result = parseServiceAccount(input);
    assert.equal(result.account, null);
    assert.ok(result.error);
    assert.ok(!result.error.includes("sensitive"));
    assert.ok(!result.error.includes(encoded));
  }
});
test("rejects invalid/missing fields without echoing input", () => {
  for (const input of ["sensitive-broken-json", "null", "[]", "{}", JSON.stringify("still a string")]) {
    const result = parseServiceAccount(input);
    assert.equal(result.account, null);
    assert.ok(result.error);
    assert.ok(!result.error.includes("sensitive"));
  }
});