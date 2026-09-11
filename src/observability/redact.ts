const sensitiveKeyPattern =
  /(api.?key|authorization|password|passcode|secret|token|member(name|id|number)|account(number)?|balance|email|phone|telephone)/i;
const secretPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

export function redactData(value: unknown, redactionValues: readonly string[] = []): unknown {
  return redactValue(value, new Set(redactionValues.filter(Boolean)));
}

function redactValue(value: unknown, redactionValues: ReadonlySet<string>, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    let redacted = value.replace(secretPattern, "[REDACTED_SECRET]");
    for (const sensitiveValue of redactionValues) {
      redacted = redacted.split(sensitiveValue).join("[REDACTED_VALUE]");
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactionValues));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, redactionValues, childKey),
      ]),
    );
  }

  return value;
}
