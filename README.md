# Automation CLI

This folder contains the computer-use automation system. It is intentionally separate from `../bank-demo`, which is only the target application.

## Current step

The current implementation contains:

- a Node.js and TypeScript project,
- a Commander-based CLI,
- environment configuration validated with Zod,
- a `health` command,
- a Playwright `browser-check` command,
- a Playwright `login-check` command,
- an accessibility-based `observe-check` command,
- a generic surface `action-check` command,
- a strict Zod schema for controlled browser and terminal actions, including business outcomes and failures,
- an action executor that routes browser actions to the surface and returns typed terminal outcomes,
- a policy guard with configurable origin, route, and action allowlists plus approval-required decisions,
- a provider-neutral LLM contract and scripted fake provider for offline testing.
- a typed, versioned capability artifact schema with parameterized inputs, outputs, checkpoints, locator fallbacks, and known outcomes.

The end-to-end discovery, artifact generation, deterministic replay, error classification, and same-session human handoff paths are implemented for the member-balance capability.

## Setup

```bash
npm install
cp .env.example .env
npm run health
```

The API key is optional for the health command. Never commit `.env`.

## Commands

```bash
npm run dev -- --help
npm run health
npm run discover -- --goal "Find member 12345 and return the savings balance"
npm run discover -- --goal "Find member 33333 and return the savings balance"
npm run replay -- --artifact ../artifacts/get_member_savings_balance.json --input memberId=24680
npm run replay -- --artifact ../artifacts/get_member_savings_balance.json --input memberId=33333
npm run dev -- browser-check
npm run dev -- browser-check --headed
npm run dev -- login-check
npm run dev -- login-check --headed
npm run dev -- observe-check
npm run dev -- observe-check --headed
npm run dev -- action-check
npm run dev -- action-check --member-id 24680 --headed
npm test
npm run typecheck
```

`discover` is the main user entry point. It accepts a natural-language goal plus target, runs the bounded LiteLLM agent loop, infers the member parameter from the successful interaction, and validates and writes `../artifacts/get_member_savings_balance.json`. Typed inputs are supplied later when replaying the artifact.

During discovery, concise `[browser]`, `[llm]`, `[agent]`, and `[policy]` messages show progress without printing prompts, raw model responses, credentials, or input values.

`replay` loads and validates an artifact and typed inputs, opens and authenticates the target, executes saved steps with locator fallbacks, detects known outcomes, verifies the checkpoint, extracts outputs, and writes run-scoped evidence under `../evidence/replay/`. It never calls LiteLLM.

Discovery and replay open a visible browser by default and automatically pause when intervention is required. The operator uses that same browser, then chooses resume, complete, or abort in the terminal. Resume is rejected if the blocker remains or the page and recorded human actions are unchanged. Use `--headless` only for unattended or CI runs; an intervention is then reported without local takeover.

`browser-check` opens `BANK_APP_URL`, verifies its HTTP response, and writes run-scoped evidence under `../evidence/check/`. Use `--headed` when you want to watch the browser.

`login-check` reads credentials from `.env`, signs in through the real UI, verifies the Member Inquiry heading, and writes run-scoped evidence under `../evidence/check/`. Credentials are never printed.

`observe-check` signs in and captures the page's accessibility snapshot and screenshot under a unique `../evidence/check/<run-id>/` directory.

`action-check` signs in and uses only the generic surface's role-based `fill` and `click` methods to open a successful member profile. It writes run-scoped before/after evidence under `../evidence/check/`.
