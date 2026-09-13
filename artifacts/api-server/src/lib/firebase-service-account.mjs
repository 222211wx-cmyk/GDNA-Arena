// Shared by the API and diagnostics. Never include input or parser exceptions
// in errors: JSON.parse messages can contain private-key fragments.
const MAX_ACCOUNT_BYTES = 128 * 1024;

function decodeBase64Json(input) {
  // Buffer's decoder silently ignores invalid characters. Require canonical
  // standard Base64 (optional padding / line wrapping) before decoding.
  const encoded = input.replace(/[ \t\r\n]/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length % 4 === 1 || (encoded.includes("=") && encoded.length % 4 !== 0)) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  // Only unwrap JSON, not arbitrary strings or recursively encoded payloads.
  return decoded.startsWith("{") || decoded.startsWith('"') || decoded.startsWith("'") ? decoded : null;
}

export function selectServiceAccount(env) {
  for (const key of ["FIREBASE_SERVICE_ACCOUNT", "FIREBASE_SERVICE_ACCOUNT_JSON", "FIBERASE_SERVICE_ACCOUNT"]) {
    if (typeof env[key] === "string" && env[key].trim()) return env[key];
  }
  return "";
}

function escapeStringLineBreaks(input) {
  let quoted = false;
  let escaped = false;
  let result = "";
  for (const char of input) {
    if (quoted && !escaped && (char === "\n" || char === "\r" || char === "\t")) {
      result += JSON.stringify(char).slice(1, -1);
      continue;
    }
    result += char;
    if (escaped) escaped = false;
    else if (quoted && char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
  }
  return result;
}

export function parseServiceAccount(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { account: null, error: "Firebase service account is not configured" };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_ACCOUNT_BYTES) {
    return { account: null, error: "Firebase service account exceeds the size limit" };
  }
  let value = raw;
  let decodedBase64 = false;
  try {
    for (let depth = 0; typeof value === "string" && depth < 5; depth++) {
      const cleaned = value.trim().replace(/^\uFEFF/, "");
      if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
        value = cleaned.slice(1, -1);
        continue;
      }
      try {
        value = JSON.parse(escapeStringLineBreaks(cleaned));
      } catch {
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
          value = cleaned.slice(1, -1);
          continue;
        }
        if (!decodedBase64) {
          const decoded = decodeBase64Json(cleaned);
          if (decoded !== null) {
            decodedBase64 = true;
            value = decoded;
            continue;
          }
        }
        throw new Error("invalid-json");
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { account: null, error: "Firebase service account must be a JSON object" };
    }
    for (const key of ["project_id", "client_email", "private_key"]) {
      if (typeof value[key] !== "string" || !value[key].trim()) {
        return { account: null, error: `Firebase service account requires a nonempty ${key} field` };
      }
    }
    return {
      account: {
        ...value,
        private_key: value.private_key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n"),
      },
      error: null,
    };
  } catch {
    return { account: null, error: "Firebase service account is not valid JSON or Base64-encoded JSON" };
  }
}