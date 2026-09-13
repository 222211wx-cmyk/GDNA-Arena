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
test("rejects invalid/missing fields without echoing input", () => {
  for (const input of ["sensitive-broken-json", "null", "[]", "{}", JSON.stringify("still a string")]) {
    const result = parseServiceAccount(input);
    assert.equal(result.account, null);
    assert.ok(result.error);
    assert.ok(!result.error.includes("sensitive"));
  }
});