const SENSITIVE_KEY_RE =
  /(^|_)(pass(word)?|secret|token|api(_)?key|session|cookie|authorization)($|_)/i;

export function redactSecrets(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactSecrets);

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (SENSITIVE_KEY_RE.test(key)) output[key] = "[REDACTED]";
      else output[key] = redactSecrets(child);
    }
    return output;
  }

  return value;
}
