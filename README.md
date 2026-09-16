# AI Software Factory

The Factory is the Operator's single-person system for turning an Idea into a shipped web Product. This repo owns the driving Surface: the `factory` CLI, the Line state under `.factory/`, and the docs that define how the Factory thinks.

Products live in sibling repos. Each Product has its own README for local development and its own Tracker for Line work; this README is only for operating the Factory from a fresh checkout.

## First Checkout

Use Node 24 or newer and an authenticated GitHub CLI:

```powershell
node --version
gh auth status
npm install
npm run factory -- state
```

`factory state` should show this repo as the Factory root, `.factory/config.json` present, and `.factory/state/` present. The command also lists discovered Products. On a new checkout that list can be empty.

The guaranteed local invocation is:

```powershell
npm run factory -- <command>
```

If you want the shorter command, link the package once from this repo:

```powershell
npm link
factory state
```

After that, the examples below can be read as either `factory ...` or `npm run factory -- ...`.

## Smoke Test

Use stub mode when you want to prove the checkout and Tracker wiring without spending model calls:

```powershell
npm run factory -- --stub
```

Stub mode uses canned agent output. It skips live model calls, but commands can still mutate local Factory state, Product repos, and GitHub Issues.

## First Line Run

Start by creating a Product. The Factory scaffolds a sibling directory, creates the Product's GitHub repo, seeds its inherited labels, and writes the Product registration that lets the day brief discover it.

```powershell
npm run factory -- new my-product
```

Then enter an Idea. The Factory records it in the Product Tracker, drives sharpening, and stops at the spec gate.

```powershell
npm run factory -- idea my-product "A tiny app that helps me plan dinner from what is already in the fridge."
```

Use the day brief to see where the Line is waiting:

```powershell
npm run factory --
```

At the spec gate, open the Product. The Surface shows the evidence bundle and waits for a Disposition.

```powershell
npm run factory -- open my-product
```

Advance the spec when it is ready:

```powershell
npm run factory -- open my-product --disposition advance
```

Revise it when the spec needs another pass:

```powershell
npm run factory -- open my-product --disposition revise --target spec --feedback "Tighten the first-run flow and remove the calendar integration."
```

Halt when the Product is off-track for a reason beyond code:

```powershell
npm run factory -- open my-product --disposition halt
```

That is the first Operator loop: create a Product, enter an Idea, read the day brief, and open the spec gate.

## Live Runs

Live stages use the model names in `.factory/config.json` and read provider credentials from the shell environment passed to the CLI. Keep credentials out of git; `.env` is ignored, but the CLI does not load it for you.

The Product's own local setup stays in the Product README. The Factory only needs enough Product registration to find it and drive its Line.

## Command Cheat Sheet

```text
factory
  Show the day brief: registered Products, Line positions, gates, forks, and stub mode.

factory state
  Show the Factory root, config, gitignored state directory, registered Products, and run table.

factory new <product>
  Scaffold a sibling Product repo and register it with the Factory.

factory idea <product> <idea>
  Record an Idea, drive sharpening, and suspend at the spec gate.

factory open <product>
  Attach to a pending gate or fork and show the evidence bundle.

factory open <product> --disposition advance
  Advance at a green gate.

factory open <product> --disposition revise --target spec --feedback <text>
  Send the Line back through spec with Operator notes.

factory open <product> --pick <n>
  Resume from a fork by choosing one of the stage's reported options.

factory tickets <owner/repo> <spec-issue>
  Cut implementation tickets from an accepted spec into the Product Tracker.

factory tickets <owner/repo> <spec-issue> --frontier
  Show the current open, unblocked, unclaimed implementation frontier.

factory implement <product>
  Drive the next implementation ticket on a sibling checkout and open a PR.

factory review <product>
  Run the review bar and surface the review gate when the bar is green.

factory intake <owner/repo> --title <title> --body <body>
  Enter an incoming Request for an existing Product and triage it to agent-ready.
```

## Where To Look Next

- `CONTEXT.md` is the Factory glossary.
- `docs/adr/` records why the Line, Surface, gates, Tracker, and review bar work this way.
- `AGENTS.md` is for agents operating in this repo, not for the Operator's first run.
- Each Product README owns that Product's local development commands.
