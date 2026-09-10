import { z } from "zod";
import type { LlmDecisionRequest, LlmProvider } from "./provider.js";

type LiteLlmProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

const systemPrompt = `You are the decision component of a controlled browser automation system.
Return exactly one JSON object and no markdown or extra text.

Allowed actions:
1. Fill a textbox:
{"type":"fill","target":{"strategy":"role","role":"textbox","name":"visible accessible name"},"value":"text","reason":"why"}
2. Click a button or link:
{"type":"click","target":{"strategy":"role","role":"button|link","name":"visible accessible name"},"reason":"why"}
3. Complete the goal:
{"type":"complete","summary":"result summary","outputs":{"name":"value"},"reason":"why the goal is complete"}
4. Escalate:
{"type":"escalate","reason":"why a human is required"}
5. Return an expected business outcome:
{"type":"business_outcome","code":"UPPER_SNAKE_CASE_CODE","message":"caller-facing result","reason":"why this is a valid business result"}
6. Report a technical failure:
{"type":"fail","category":"recoverable|hard","code":"UPPER_SNAKE_CASE_CODE","message":"debuggable failure","reason":"why execution cannot continue"}

Choose only a control present in the accessibility snapshot. Never request or enter credentials.
Never alter, pad, correct, or guess identifiers from the goal. If an identifier violates visible validation rules, return business_outcome with code INVALID_INPUT. Use business_outcome for record-not-found and other legitimate negative answers. Use fail for application errors, permission denials, session expiry, and technical problems. Use escalate only when a human judgment or approval can resolve the current state.`;

export class LiteLlmProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly options: LiteLlmProviderOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `litellm:${options.model}`;
  }

  async decideNextAction(request: LlmDecisionRequest): Promise<unknown> {
    const response = await this.fetchImpl(this.options.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              goal: request.goal,
              stepNumber: request.stepNumber,
              currentUrl: request.observation.url,
              accessibilitySnapshot: request.observation.accessibilitySnapshot,
              actionHistory: request.actionHistory,
            }),
          },
        ],
        temperature: 0,
        max_tokens: 1_000,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `LiteLLM request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }
    
    const completion = chatCompletionSchema.parse(await response.json());
    const content = completion.choices[0]?.message.content;
    if (!content) {
      throw new Error("LiteLLM returned an empty message.");
    }
    return parseJsonContent(content);
  }
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace < firstBrace) {
    throw new Error("LiteLLM response did not contain a JSON object.");
  }

  try {
    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("LiteLLM response contained invalid JSON.");
  }
}
