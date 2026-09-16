# {{product}}

A web app produced by the AI Software Factory.

## Stack

| Layer     | Choice                  | Notes                                             |
| --------- | ----------------------- | ------------------------------------------------- |
| Runtime   | Node / TypeScript       |                                                   |
| Framework | Next.js 15 (App Router) | Server-first data handling                        |
| Database  | SQLite via Drizzle ORM  | Schema Postgres-compatible for later growth       |
| Auth      | None by default         | Add via Auth.js when needed (`npm i next-auth`)   |
| Deploy    | Local dev + Vercel      | `vercel` CLI or push to GitHub                    |

## Local development

```bash
npm install
npm run db:generate && npm run db:migrate
npm run dev          # http://localhost:3000
```

## Tracker

This Product's tracker lives on GitHub Issues in this repository. Labels:

| Label              | Meaning                                      |
| ------------------ | -------------------------------------------- |
| `needs-triage`     | Maintainer needs to evaluate this issue      |
| `needs-info`       | Waiting on reporter for more information     |
| `ready-for-agent`  | Fully specified, ready for an AFK agent      |
| `ready-for-human`  | Requires human implementation                |
| `wontfix`          | Will not be actioned                         |

## The Line

Work flows through this Product via the Factory's Line:

1. **Sharpening** (driven) — raw input refined into a request
2. **Spec** (gated) — the Operator decides the spec before implementation begins
3. **Tickets** (driven) — spec broken into agent-ready tickets
4. **Implementation** (driven) — tickets executed via the frontier
5. **Review** (gated) — three-layered check: automated, independent agent, then the Operator sees the running app and decides: advance, revise, or halt
6. **Ship** (driven) — the Operator's disposition at review rides through

## Decisions

Architecture Decision Records live in `docs/adr/`. Domain vocabulary lives in `CONTEXT.md`. Agent-facing operating notes live in `AGENTS.md` and `docs/agents/`.

## Deploy

Push to GitHub → Vercel detects the Next.js project and deploys automatically (push-to-deploy). The Operator authenticates with Vercel separately when ready. See [Vercel Next.js docs](https://vercel.com/docs/frameworks/nextjs) for setup.

## Project structure

```
├── src/app/           Next.js pages and API routes
├── src/db/            Drizzle client, connected to SQLite
├── drizzle/           Schema and migration runner
├── docs/
│   ├── adr/           Architecture Decision Records
│   └── agents/        Agent harness (issue tracker, triage labels, domain docs)
├── .factory/state/
│   └── product.json   Product registration (repo, stack, Line state) — gitignored
├── CONTEXT.md         Domain glossary for this Product
├── AGENTS.md          Agent-facing instructions for this Product's Line
└── .env.example       Template for local environment
```