import assert from "node:assert/strict";
import test from "node:test";
import { isApnsVoipMock } from "./apns-voip-mode";

test("APNs defaults to mock; only explicit live mode enables real delivery", () => {
  const previous = process.env.APNS_VOIP_MODE;
  try {
    delete process.env.APNS_VOIP_MODE;
    assert.equal(isApnsVoipMock(), true);
    for (const value of ["mock", "", "production", "invalid"]) {
      process.env.APNS_VOIP_MODE = value;
      assert.equal(isApnsVoipMock(), true);
    }
    process.env.APNS_VOIP_MODE = "live";
    assert.equal(isApnsVoipMock(), false);
  } finally {
    if (previous === undefined) delete process.env.APNS_VOIP_MODE;
    else process.env.APNS_VOIP_MODE = previous;
  }
});