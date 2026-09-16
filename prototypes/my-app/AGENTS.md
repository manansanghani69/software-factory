# Agent instructions — my-app

This file tells agent sessions how to work on this Product's Line.

## Before exploring, read

- `CONTEXT.md` — the domain glossary for this Product
- `docs/agents/domain.md` — how to consume domain docs
- `docs/agents/issue-tracker.md` — how to interact with this repo's tracker
- `docs/agents/triage-labels.md` — label mapping

## The Line

Work follows the Factory's Line: sharpening → spec → tickets → implementation → review → ship. Spec and review are gated — the Line stops for an Operator decision. All other stages drive.

## Tracker

GitHub Issues. Use `gh` CLI for all operations. See `docs/agents/issue-tracker.md` for commands.

## Decisions

Architecture Decision Records live in `docs/adr/`. When a decision is made during the Line, record it there.
