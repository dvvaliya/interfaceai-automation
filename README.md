# Automation System

This directory contains only the computer-use automation system. The fictional banking target is the sibling project at `../bank-demo`.

The complete project setup, demo path, architecture, and evidence guide are documented in `../README.md` and `../REPORT.md`.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run health
```

Keep `.env` local. Never commit model keys or real credentials.

## Main Commands

Run real LLM discovery:

```bash
npm run discover -- \
  --goal "Find member 12345 and return the savings balance" \
  --target "http://localhost:3000"
```

Replay the generated capability without an LLM:

```bash
npm run replay -- \
  --artifact ../artifacts/get_member_savings_balance.json \
  --input memberId=24680
```

Run unattended:

```bash
npm run replay -- \
  --artifact ../artifacts/get_member_savings_balance.json \
  --input memberId=24680 \
  --headless
```

Run checks:

```bash
npm test
npm run typecheck
npm run build
```

Runtime artifacts and evidence are written to the sibling directories `../artifacts` and `../evidence`. The generated artifact ID follows the requested member output, for example `get_member_name` or `get_member_savings_balance`.
