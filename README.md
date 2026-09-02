# FinSight Prototype

FinSight is a high-fidelity, frontend-only prototype for the Final Year Project topic **Finance Intelligence: AI-Driven Financial Analysis and Automated Reporting**.

The prototype uses realistic Malaysian Ringgit mock data to validate the proposed workflow:

1. ingest and normalize financial files;
2. reconcile ledger and bank transactions;
3. analyze performance and variance;
4. forecast revenue and cash flow;
5. investigate unusual transactions; and
6. preview a management-ready monthly report.

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

## Prototype boundaries

This project does not contain a backend, database, authentication, real file parsing, trained AI/ML models, banking integrations, or PDF generation. Evaluation values are clearly labeled mock prototype data and are not experimental results.
