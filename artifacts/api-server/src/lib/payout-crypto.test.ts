import assert from "node:assert/strict";
import test from "node:test";
import { decryptPayoutDetails, encryptPayoutDetails, maskAccount } from "./payout-crypto.js";
test("payout details use authenticated encryption and masked reads",()=>{
  const secret="a-deliberately-long-test-session-secret";
  const encrypted=encryptPayoutDetails({accountNumber:"1234567890",bankName:"Test Bank"},secret);
  assert.equal(encrypted.includes("1234567890"),false);
  assert.deepEqual(decryptPayoutDetails(encrypted,secret),{accountNumber:"1234567890",bankName:"Test Bank"});
  assert.equal(maskAccount("1234 567890"),"••••7890");
  const parts=encrypted.split(".");
  const ciphertext=Buffer.from(parts[2],"base64url");
  ciphertext[Math.floor(ciphertext.length/2)]^=1;
  const tampered=[parts[0],parts[1],ciphertext.toString("base64url")].join(".");
  assert.throws(()=>decryptPayoutDetails(tampered,secret));
});