# Factory — first slice (prototype)

Throwaway prototype proving the TypeScript + Mastra stack for the Factory program
(ADR `0005-factory-program-stack`). It builds the thin first slice end-to-end:

```
factory idea "<idea>"  →  sharpening issue in tracker  →  Mastra sharpening agent  →  spec gate (suspend)  →  advance/revise
```

## What it proves

- **CLI works** — a thin `factory` command in TypeScript (Commander).
- **GitHub works** — the Operator's idea becomes a real issue in this repo's tracker
  with `idea` + `needs-sharpening` labels, created idempotently.
- **An agent session driven by a skill works** — a Mastra agent whose instructions
  come from the sharpening skill content turns the idea into a spec.
- **The human gate works** — the workflow `suspend()`s at the spec gate, the Operator
  replies `advance` or `revise`, and `resume()` carries the session forward. A `revise`
  re-runs the sharpener with the feedback; `advance` closes the issue and posts the spec.

## Running it

```sh
npm install

# stub mode — no API key needed; exercises CLI → issue → workflow → gate
npm run factory -- idea "An idea to sharpen" --stub

# real mode — needs ANTHROPIC_API_KEY
copy .env.example .env   # then fill in the key
npm run factory -- idea "An idea to sharpen"

# day brief — lists open tracker issues for the Operator
npm run factory -- day
```

`--repo owner/repo` overrides the tracker repo; otherwise it is inferred from
`git remote get-url origin`. Run from inside this `prototypes/first-slice` directory.

## Mechanics worth carrying forward

- On suspend, the resume payload is keyed by step id:
  `result.suspendPayload?.['spec-gate']` holds `{ spec, issueUrl }`.
- The workflow requires `initialState: { spec: '' }` on `run.start`, or Mastra fails
  schema validation (`WORKFLOW_SCHEMA_VALIDATION_FAILED`).
- Workflow `stateSchema` persists across suspend/resume; the revisited spec is carried
  by the workflow state, not by the resume payload.
- `FACTORY_STUB=1` swaps the model output for a canned spec, so the whole path can be
  tested without an API key.
- The CLI reads piped stdin line-by-line over a shared readline interface; stdin that
  is not a TTY is fully consumed up front so commands stay scriptable.