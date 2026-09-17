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
    let redacted = redactSensitiveText(value);
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

function redactSensitiveText(value: string): string {
  return value
    .replace(secretPattern, "[REDACTED_SECRET]")
    .replace(/\b\d{5}\b/g, "[REDACTED_MEMBER_ID]")
    .replace(/\$\d[\d,]*\.\d{2}/g, "[REDACTED_BALANCE]")
    .replace(/\b(?:SAV|CHK)-\*{4}-\d{4}\b/g, "[REDACTED_ACCOUNT]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\(\*{3}\) \*{3}-\d{4}/g, "[REDACTED_PHONE]")
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[REDACTED_DATE]")
    .replace(/(Member Name )[^"\n]+/g, "$1[REDACTED_NAME]")
    .replace(/- cell "[A-Z][a-z]+ [A-Z][A-Za-z'-]+"/g, '- cell "[REDACTED_NAME]"')
    .replace(/\([A-Z][a-z]+ [A-Z][A-Za-z'-]+\)/g, "([REDACTED_NAME])");
}
