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
  for (const key of ["FIREBASE_SERVICE_ACCOUNT", "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBACE_SERVICE_ACCOUNT", "FIBERASE_SERVICE_ACCOUNT"]) {
    if (typeof env[key] === "string" && env[key].trim()) return env[key];
  }
  return "";
}

export function resolveServiceAccount(env) {
  const primary = parseServiceAccount(selectServiceAccount(env));
  if (primary.account) return { ...primary, source: "service-account-json" };
  const fields = {
    project_id: env.FIREBASE_PROJECT_ID,
    client_email: env.FIREBASE_CLIENT_EMAIL,
    private_key: env.FIREBASE_PRIVATE_KEY,
  };
  const missing = Object.entries(fields)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([field]) => `FIREBASE_${field.toUpperCase()}`);
  if (missing.length) {
    return { ...primary, source: null, missingFallbackFields: missing };
  }
  let key = fields.private_key.trim();
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  // Keep the same validation and PEM newline normalization for both sources.
  const fallback = parseServiceAccount(JSON.stringify({
    type: "service_account",
    project_id: fields.project_id.trim(),
    client_email: fields.client_email.trim(),
    private_key: key,
  }));
  return { ...fallback, source: fallback.account ? "individual-env" : null };
}

function escapeStringLineBreaks(input) {
  let quoted = false;
  let escaped = false;
  let result = "";
  for (const char of input) {
    if (quoted && (char === "\n" || char === "\r" || char === "\t")) {
      // A pasted backslash followed by a literal line break is not a JSON
      // escape. Replace that broken escape with the JSON control escape.
      if (escaped) result = result.slice(0, -1);
      result += JSON.stringify(char).slice(1, -1);
      escaped = false;
      continue;
    }
    result += char;
    if (escaped) escaped = false;
    else if (quoted && char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
  }
  return result;
}

// JSON.parse can quote the input in SyntaxError.message. Never return that
// message: only fixed categories and numeric coordinates may leave the parser.
export function safeJsonError(error) {
  if (!(error instanceof SyntaxError)) return "JSON_PARSE_FAILED";
  const message = error.message;
  const category = /^Bad control character/.test(message) ? "JSON_CONTROL_CHARACTER" :
    /^Bad escaped character/.test(message) ? "JSON_INVALID_ESCAPE" :
    /^Unterminated string/.test(message) ? "JSON_UNTERMINATED_STRING" :
    /^Unexpected end/.test(message) ? "JSON_UNEXPECTED_END" :
    /^Unexpected token/.test(message) ? "JSON_UNEXPECTED_TOKEN" :
    /^Unexpected non-whitespace character/.test(message) ? "JSON_TRAILING_CONTENT" :
    /^(Expected property name|Expected double-quoted property name)/.test(message) ? "JSON_PROPERTY_NAME_EXPECTED" :
    "JSON_SYNTAX_ERROR";
  const position = message.match(/\bat position (\d+)(?: \(line (\d+) column (\d+)\))?$/);
  return position
    ? `${category} at position ${position[1]}${position[2] ? ` (line ${position[2]} column ${position[3]})` : ""}`
    : category;
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
  let diagnostic = null;
  try {
    for (let depth = 0; typeof value === "string" && depth < 5; depth++) {
      const cleaned = value.trim().replace(/^\uFEFF/, "");
      if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
        value = cleaned.slice(1, -1);
        continue;
      }
      try {
        value = JSON.parse(escapeStringLineBreaks(cleaned));
      } catch (error) {
        diagnostic = safeJsonError(error);
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
        private_key: value.private_key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n?/g, "\n"),
      },
      error: null,
    };
  } catch {
    return {
      account: null,
      error: "Firebase service account is not valid JSON or Base64-encoded JSON",
      diagnostic,
    };
  }
}