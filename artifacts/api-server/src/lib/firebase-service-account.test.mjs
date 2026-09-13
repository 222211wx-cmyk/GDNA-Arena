import assert from "node:assert/strict";
import test from "node:test";
import { parseServiceAccount, selectServiceAccount, safeJsonError } from "./firebase-service-account.mjs";

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
  assert.equal(selectServiceAccount({ FIREBACE_SERVICE_ACCOUNT: "replacement" }), "replacement");
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

test("standard Google PEM JSON and pasted LF/CRLF variants normalize equally", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nTEST_ONLY_NOT_A_KEY\n-----END PRIVATE KEY-----\n";
  const standard = JSON.stringify({ ...fixture, type: "service_account", private_key: pem }, null, 2);
  for (const source of [
    standard,
    standard.replace(/\\n/g, "\n"),
    standard.replace(/\\n/g, "\r\n"),
    standard.replace(/\\n/g, "\\\n"),
    standard.replace(/\\n/g, "\\\r\n"),
  ]) {
    const parsed = parseServiceAccount(source);
    assert.equal(parsed.error, null);
    assert.equal(parsed.account.private_key, pem);
  }
});

test("safe diagnostics never include input fragments or raw exception messages", () => {
  for (const source of ["SECRET_NOT_JSON", '{"private_key":"SECRET_MATERIAL",}']) {
    const result = parseServiceAccount(source);
    assert.equal(result.account, null);
    assert.ok(result.diagnostic.startsWith("JSON_"));
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  assert.equal(
    safeJsonError(new SyntaxError("Bad control character in string literal in JSON at position 12 (line 2 column 3)")),
    "JSON_CONTROL_CHARACTER at position 12 (line 2 column 3)",
  );
  assert.equal(safeJsonError(new SyntaxError('Unexpected token \'S\', "SECRET_KEY" is not valid JSON')), "JSON_UNEXPECTED_TOKEN");
});