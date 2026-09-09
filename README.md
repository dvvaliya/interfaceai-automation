# Automation CLI

This folder contains the computer-use automation system. It is intentionally separate from `../bank-demo`, which is only the target application.

## Current step

The current implementation contains:

- a Node.js and TypeScript project,
- a Commander-based CLI,
- environment configuration validated with Zod,
- a `health` command,
- a Playwright `browser-check` command.

LLM calls, discovery, artifacts, and replay are not implemented yet.

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
npm run dev -- browser-check
npm run dev -- browser-check --headed
npm run typecheck
```

`browser-check` opens `BANK_APP_URL`, verifies its HTTP response, prints the page title and final URL, and writes `evidence/browser-check.png`. Use `--headed` when you want to watch the browser.
