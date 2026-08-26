import crypto from "node:crypto";
function key(secret:string){ return crypto.scryptSync(secret,"gdna-finance-payout-details-v1",32); }
export function encryptPayoutDetails(value:unknown,secret:string){
  if(secret.length<16) throw new Error("SESSION_SECRET must be at least 16 characters for payout details");
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",key(secret),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(".");
}
export function decryptPayoutDetails(payload:string,secret:string){
  const [i,t,c]=payload.split("."); const decipher=crypto.createDecipheriv("aes-256-gcm",key(secret),Buffer.from(i,"base64url"));
  decipher.setAuthTag(Buffer.from(t,"base64url")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(c,"base64url")),decipher.final()]).toString("utf8"));
}
export function maskAccount(value:string){ const clean=value.replace(/\s+/g,""); return `••••${clean.slice(-4)}`; }