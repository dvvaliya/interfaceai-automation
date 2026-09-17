export class SensitiveTokenizer {
  private readonly valueToToken = new Map<string, string>();
  private readonly tokenToValue = new Map<string, string>();

  constructor(sourceValues: readonly unknown[]) {
    const combined = sourceValues.map((value) => JSON.stringify(value)).join("\n");
    const candidates = collectCandidates(combined).sort((left, right) => right.length - left.length);
    candidates.forEach((value, index) => {
      const token = `<SENSITIVE_${index + 1}>`;
      this.valueToToken.set(value, token);
      this.tokenToValue.set(token, value);
    });
  }

  tokenize(value: unknown): unknown {
    return transformValue(value, (text) => this.replaceAll(text, this.valueToToken));
  }

  detokenize(value: unknown): unknown {
    return transformValue(value, (text) => this.replaceAll(text, this.tokenToValue));
  }

  private replaceAll(text: string, replacements: ReadonlyMap<string, string>): string {
    let result = text;
    for (const [source, replacement] of replacements) {
      result = result.split(source).join(replacement);
    }
    return result;
  }
}

function collectCandidates(contents: string): string[] {
  const values = new Set<string>([
    ...(contents.match(/\b\d{5}\b/g) ?? []),
    ...(contents.match(/\$\d[\d,]*\.\d{2}/g) ?? []),
    ...(contents.match(/\b(?:SAV|CHK)-\*{4}-\d{4}\b/g) ?? []),
    ...(contents.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
    ...(contents.match(/\(\*{3}\) \*{3}-\d{4}/g) ?? []),
    ...(contents.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) ?? []),
  ]);

  for (const match of contents.matchAll(/Member Name ([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'-]+)+)/g)) {
    if (match[1]) values.add(match[1]);
  }
  for (const match of contents.matchAll(/\(([A-Z][a-z]+ [A-Z][A-Za-z'-]+)\)/g)) {
    if (match[1]) values.add(match[1]);
  }

  return [...values].filter((value) => value.length >= 3);
}

function transformValue(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((item) => transformValue(item, transform));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, transformValue(child, transform)]),
    );
  }
  return value;
}
