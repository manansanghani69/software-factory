# Factory Runtime Stack — Research Findings

**Ticket:** [#3 Factory Runtime Stack — research](https://github.com/manansanghani69/software-factory/issues/3)
**Date:** 2026-09-14
**Status:** Research complete — findings only, no stack decision.

## TL;DR

All three candidate runtimes (Node/TypeScript, Python, Go) are viable for building the Factory's CLI-and-or-dashboard program. Node/TypeScript has the strongest GitHub API story (Octokit is first-party, the `gh` CLI itself is built in Go but has a JS-friendly JSON output mode) and the most mature agent orchestration SDKs that support human-in-the-loop with serializable pause/resume state. Python has the richest agent framework ecosystem (LangGraph, OpenAI Agents SDK, Claude Agent SDK) with the deepest HITL primitives, plus Textual for building terminal dashboards that can also serve over the web. Go produces a single static binary with fast startup but has the weakest agent orchestration story and the smallest ecosystem for interactive TUIs. The inherited mattpocock skills are markdown prompt files designed for agent sessions; a program could drive them by spawning agent sessions with the skill content as system prompts, or could re-implement their mechanics natively.

---

## 1. Candidate Toolchains

### Node / TypeScript

**CLI maturity:** Excellent. Commander.js (v15, May 2026) is the dominant CLI framework with zero dependencies, full TypeScript support, auto-generated help, and shell completions for bash/zsh/fish/powershell. Ink (React for terminal) provides rich interactive TUIs — used by Claude Code CLI itself. oclif (v4) offers a plugin-based architecture for larger multi-command tools. ([Commander.js](https://github.com/tj/commander.js), [Ink](https://github.com/vadimdemedes/ink), [Claude Code architecture](https://github.com/lai3d/claude-code-architecture))

**Dashboard maturity:** Excellent. Any local web dashboard can be built with Express/Hono/Fastify serving a React/Next.js frontend. Ink-based terminal dashboards are production-ready (Claude Code ships one with 200+ React components). Node 24 LTS ships native ESM, native fetch, and a built-in test runner.

**Long-running processes:** Node's event loop and async model are well-suited for long-running orchestration. The `child_process` and `worker_threads` modules handle subprocess management. Claude Code itself runs as a long-lived Node/TypeScript process with Ink rendering.

**Packaging/distribution:** `npm link` for local development, `npx` for one-off execution, `npm install -g` for global install. tsup/esbuild bundles to a single JS file. Can also be packaged as a standalone executable with `pkg` or `sea` (Node.js Single Executable Applications).

**Ecosystem health:** Largest package ecosystem (npm). TypeScript is the dominant language for new tooling. Node 24 LTS active. Weekly npm downloads for Commander: 415K; Ink: widely adopted. ([Commander.js npm](https://www.npmjs.com/package/commander))

### Python

**CLI maturity:** Very good. Typer (built on Click, by FastAPI's author) provides type-hint-driven CLI development with auto-completion, help, and Rich integration for beautiful terminal output. Click (v8.4, maintained) is the underlying workhorse. Rich provides rich terminal formatting (tables, markdown, syntax highlighting). ([Typer](https://typer.tiangolo.com/), [Click](https://pypi.org/project/click/), [Rich](https://github.com/Textualize/rich))

**Dashboard maturity:** Excellent — with Textual. Textual (v8.2, Textualize) is a Python framework for building sophisticated terminal UIs that also run in the browser via `textual serve`. Reactive state management, CSS styling, widgets (DataTable, Tree, Button, Input, ProgressBar). Used in production by Dolphie (MySQL monitor), Harlequin (DuckDB IDE), Elia (ChatGPT client). ([Textual](https://textual.textualize.io/), [Textual GitHub](https://github.com/Textualize/textual))

**Long-running processes:** Python's asyncio and threading support long-running processes well. LangGraph and the OpenAI Agents SDK are both async-first. uvicorn/FastAPI handle persistent server processes.

**Packaging/distribution:** `pip install`, `pipx` for isolated CLI tools. Can be bundled with PyInstaller or shiv for a single-file executable. Python dependency management has improved dramatically with `uv` (Astral) and `rye`.

**Ecosystem health:** Python is the dominant language for AI/ML tooling. The AI agent framework ecosystem is concentrated in Python. Textual is actively maintained by Textualize. The `uv` package manager has dramatically improved Python DX.

### Go

**CLI maturity:** Excellent. Cobra (v1.10.x) powers `kubectl`, `gh`, `hugo` and most major Go CLIs. Provides nested subcommands, POSIX flags, auto-generated help, shell completions, and integration with Viper for config management. `cobra-cli` scaffolds projects. Bubble Tea (v2.x, Charm) provides interactive TUIs using the Elm architecture — composable components (Bubbles), styling (Lip Gloss), forms (Huh). Cobra + Bubble Tea is the standard Go CLI pattern. ([Cobra](https://github.com/spf13/cobra), [Bubble Tea](https://github.com/charmbracelet/bubbletea), [Go CLI comparison](https://www.danilchenko.dev/posts/go-cli-frameworks/))

**Dashboard maturity:** Limited. Bubble Tea provides terminal dashboards (interactive menus, tables, progress bars). For a web dashboard, you'd need a Go web framework (Fiber, Echo) plus a frontend framework — no equivalent to Textual's "terminal app is also a web app" story.

**Long-running processes:** Go's goroutines are excellent for concurrent long-running processes. Single-binary deployment with no runtime dependencies. Fast startup and low memory usage.

**Packaging/distribution:** Single static binary — the best distribution story. `go build` produces a platform-specific binary. Cross-compilation is trivial. Can be distributed via Homebrew, Go install, or direct binary download.

**Ecosystem health:** Go is mature and well-supported. The agent framework ecosystem is the smallest of the three candidates. Cobra and Bubble Tea are actively maintained by Charm and the Go community.

---

## 2. GitHub Integration Story

### Node / TypeScript — Octokit (first-party)

**Octokit** is GitHub's official JavaScript SDK, maintained by GitHub. The `octokit` package (v5.0, 4.5M weekly downloads) bundles REST API client, GraphQL, authentication, App support, and Action client. ([Octokit](https://github.com/octokit/octokit.js), [npm](https://www.npmjs.com/package/octokit))

- **REST API:** `@octokit/rest` — every endpoint has a typed method: `octokit.rest.issues.create()`, `octokit.rest.issues.listLabelsOnIssue()`, etc.
- **GraphQL:** `octokit.graphql()` — full access to GitHub's GraphQL API including sub-issues and dependencies.
- **Sub-issues:** The GitHub REST API exposes `GET/POST/DELETE /repos/{owner}/{repo}/issues/{number}/sub_issues` and `PATCH /repos/{owner}/{repo}/issues/{number}/sub_issues/priority`. Octokit types these via `@octokit/openapi-types.ts` (v25.1, includes sub-issues endpoints). ([GitHub sub-issues API](https://docs.github.com/en/rest/issues/sub-issues))
- **Issue dependencies:** The REST API exposes `/repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by` and `/blocking`. Typed in `@octokit/openapi-types.ts`. ([GitHub dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies))
- **`gh` CLI embedding:** The `gh` CLI outputs JSON (`--json`) that can be parsed in JS/TS. `gh api` can be called from `child_process.exec()`. Since `gh` v2.94.0, sub-issues, issue types, and dependencies are directly supported via `gh issue` commands. ([gh v2.94.0 changelog](https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/))

**What this means:** Node/TypeScript has the strongest GitHub integration story. Octokit is first-party, fully typed, covers every API surface including sub-issues and dependencies, and the `gh` CLI can be used alongside for complex operations.

### Python — PyGithub + gh CLI

**PyGithub** (v2.9+) is a Python client for GitHub's REST API. As of mid-2025, it supports sub-issues (get, add, remove, reprioritize) and issue dependencies (blocked_by, blocking). ([PyGithub sub-issues PR](https://github.com/PyGithub/PyGithub/pull/3258), [PyGithub docs](https://pygithub.readthedocs.io/en/latest/))

- **Sub-issues:** `issue.get_sub_issues()`, `issue.add_sub_issue()`, `issue.remove_sub_issue()`, `issue.reprioritize_sub_issue()`
- **Dependencies:** `issue.get_blocked_by()`, `issue.add_blocked_by()`
- **GraphQL:** PyGithub does not natively support GraphQL. For GraphQL, use `gql` or `strawberry-graphql` with GitHub's GraphQL endpoint.
- **`gh` CLI embedding:** Same as Node — `subprocess.run(["gh", "issue", "view", ...])` with JSON output parsing.

**What this means:** Python's GitHub integration is solid via PyGithub with sub-issue and dependency support. Weaker than Node because there's no first-party SDK (PyGithub is community-maintained) and no native GraphQL support. The `gh` CLI provides parity for complex operations.

### Go — go-github + gh CLI (native)

**go-github** (v90) is Google's official Go client for GitHub's v3 API. Sub-issues were added in PR #3580 (merged May 2025) and issue dependencies in PR #4130. ([go-github](https://github.com/google/go-github))

- **Sub-issues:** `IssuesService` methods for add, remove, list, reprioritize sub-issues.
- **Dependencies:** `ListBlockedBy`, `AddBlockedBy`, `RemoveBlockedBy`, `ListBlocking` methods.
- **GraphQL:** `ghgraphql` package provides GraphQL support.
- **`gh` CLI embedding:** The `gh` CLI itself is written in Go using Cobra. Go programs can shell out to `gh` or use `gh` as a library (though the `gh` CLI library is not a public API). JSON output parsing is straightforward.

**What this means:** Go has excellent GitHub API coverage via go-github (first-party from Google, actively maintained). The `gh` CLI was written in Go, so there's philosophical alignment. However, the Factory program is not a Go project, so the benefit of `gh` being in Go is aesthetic rather than practical.

---

## 3. Agent Orchestration Frameworks

### OpenAI Agents SDK

**Language:** Python (primary), TypeScript (available)
**Maturity:** Production-ready. HITL support added in v0.8.0 (Python, Dec 2025) with `RunState` serialization and resume.
**Model support:** OpenAI models primarily, but extensible to other providers.
**HITL:** First-class. Tools declare `needs_approval=True`. The runner pauses, surfaces `ToolApprovalItem` entries in `result.interruptions`. You convert to `RunState`, call `state.approve()` or `state.reject()`, and resume with `Runner.run(agent, state)`. `RunState` is serializable to JSON, enabling durable pause/resume across process restarts. Supports `always_approve`/`always_reject` sticky decisions. Works across handoffs and nested `Agent.as_tool()` calls. ([HITL docs](https://openai.github.io/openai-agents-python/human_in_the_loop/), [PR #2230](https://github.com/openai/openai-agents-python/pull/2230))

**Durable execution:** Integrations with Dapr, Temporal, Restate, and DBOS for long-running workflows with failure recovery.

**Fit for the Factory:** Good for agent orchestration. The SDK's handoff pattern (multiple specialists with different instructions/tools) maps to the Factory's Line stages. HITL is mature and serializable. However, the SDK is OpenAI-centric — if the Factory needs to use Claude or other models, this is a limitation.

### LangGraph

**Language:** Python
**Maturity:** Production-ready, widely adopted (Klarna, Uber, Replit, Elastic). LangGraph is the lower-level execution engine; LangChain provides the component library. As of 2026, LangChain's agents run on LangGraph's runtime.
**Model support:** Any LLM provider — LangChain integrates with OpenAI, Anthropic, Google, Cohere, and many others.
**HITL:** Native. `interrupt()` function pauses graph execution at any node. `interrupt_before=["node"]` on graph compilation. State is checkpointed (MemorySaver for dev, PostgresSaver for production). Resume with `graph.invoke(Command(resume=...), config)`. ([LangGraph GitHub](https://github.com/langchain-ai/langgraph), [HITL tutorial](https://towardsdatascience.com/building-human-in-the-loop-agentic-workflows/))

**Control flow:** Graph-based (StateGraph). Nodes are Python functions; edges are routing rules. TypedDict state flows through all nodes. Conditional edges enable branching. Cyclic graphs allow retry loops. Durable execution with checkpointing.

**Fit for the Factory:** Excellent. The graph-based model maps naturally to the Factory's Line (sharpening → spec → tickets → implementation → review → ship). Each Line stage is a node. Conditional edges handle branching (e.g., review pass/fail). `interrupt_before` at chosen stages provides human gates. The model-agnostic nature means the Factory can use Claude, GPT, or any model. Community comparisons consistently rank LangGraph as the most production-mature agent framework. ([LangGraph overview](https://www.langchain.com/langgraph))

### Claude Agent SDK (Anthropic)

**Language:** Python, TypeScript
**Maturity:** Production-ready. Bundles the Claude Code CLI runtime — agents get Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch tools out of the box.
**Model support:** Claude models (Anthropic).
**HITL:** Supported via permissions and approval flows. The SDK supports `allowed_tools` pre-approval, and the CLI has interactive approval prompts. For programmatic HITL, tools can be configured with approval requirements. Dynamic workflows (Claude Code feature) spawn subagents via JavaScript orchestration scripts. ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Dynamic workflows cookbook](https://platform.claude.com/cookbook/claude-agent-sdk-08-dynamic-workflows))

**Subagents:** The Agent SDK spawns specialized agents for focused subtasks. Dynamic workflows coordinate up to 16 concurrent agents, up to 1,000 per run. Each subagent runs in its own clean context.

**Fit for the Factory:** Good if the Factory uses Claude exclusively. The built-in tools (file editing, bash, search) are directly relevant to the implementation and review stages. The dynamic workflow pattern (orchestrator-workers) maps to the Factory's Line. However, it's Claude-only, which limits flexibility.

### Mastra

**Language:** TypeScript
**Maturity:** Active development, production-growing. Open-source TypeScript framework for AI agents and applications.
**Model support:** Multiple providers via `provider/model` string format (OpenAI, Anthropic, Google).
**HITL:** Suspend/resume on workflow steps. `suspend()` pauses a step, saving execution state to storage. `resume()` continues from the paused step with `resumeData`. Supports `bail()` for human rejection. Multi-turn human input supported. ([Mastra workflows](https://mastra.ai/docs/workflows/overview), [HITL docs](https://mastra.ai/docs/workflows/human-in-the-loop))

**Fit for the Factory:** Strong if the Factory is built in TypeScript. Mastra's workflow engine with `.then()`, `.branch()`, `.parallel()` control flow maps to the Line stages. Built-in observability, evals, and memory. Integrates with Next.js/React for dashboards. However, Mastra is younger than LangGraph and the HITL story is less battle-tested.

---

## 4. Driving the Inherited Skills Programmatically

### How the mattpocock skills work

The skills are **markdown prompt files** (`.md`) loaded into an agent session (Claude Code, Codex, etc.) via the `Skill` tool or the `npx skills` installer. Each skill file contains instructions, workflows, and references to other files. They are designed to be consumed by an LLM agent in an interactive session. Key characteristics:

- **Invocation:** User-invoked skills (`/grill-me`, `/implement`, `/wayfinder`) are triggered by the user typing a command. Model-invoked skills (`/research`, `/tdd`, `/code-review`) are reached automatically by the agent when the task fits.
- **State:** Skills operate within a session's context window. State is maintained by the agent's conversation history. The `handoff` skill compacts conversation state into a handoff document.
- **Orchestration:** Skills like `wayfinder` and `implement` orchestrate multi-step workflows using the issue tracker (`gh` CLI) as the shared state surface. They create issues, apply labels, set dependencies, and close tickets.
- **Subagents:** Skills like `code-review` spawn parallel sub-agents (e.g., standards review + spec review) using the agent harness's subagent capability.
- **Configuration:** The `setup-matt-pocock-skills` skill configures the repo with `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and `docs/agents/domain.md`. These files tell the skills how to interact with the issue tracker. ([mattpocock/skills](https://github.com/mattpocock/skills))

### How a program could drive them

**Option A: Spawn agent sessions with skill content as system prompts.** The Factory program reads the skill markdown files and injects them as system prompts into agent SDK calls (OpenAI Agents SDK, LangGraph, Claude Agent SDK). Each Line stage is a separate agent run with a different skill as the system prompt. The program manages the orchestration (creating issues, reading state, advancing stages) while the agent handles the domain-specific work. This preserves the skill mechanics without reimplementing them.

**Option B: Re-implement the mechanics natively.** The Factory program reads the skill markdown files to understand the intended behavior, then implements the same workflows as native code: issue creation/labeling via Octokit/PyGithub, pipeline state via a database or file, agent orchestration via the chosen framework. The skill files become documentation/specification rather than executable prompts.

**Option C: Hybrid — use skills for domain logic, program for orchestration.** The Factory program handles the mechanical parts (issue management, stage transitions, human gates) while delegating domain-specific work (sharpening, spec writing, code review) to agent sessions that receive the relevant skill content. This is the most pragmatic approach: the program does what programs do best (state management, API calls, UI) while agents do what agents do best (reasoning, generation, review).

**What this means:** The skills are not a binding constraint on the runtime stack. They are markdown files that any agent SDK can consume. The key question is whether the Factory program re-implements the skill mechanics (Option B) or delegates to agent sessions that use them (Options A/C). Either way, the choice of runtime stack is independent of the skill system.

---

## Summary: What This Means for the Stack Decision (Ticket #8)

| Factor | Node/TypeScript | Python | Go |
|--------|----------------|--------|-----|
| CLI maturity | Excellent (Commander + Ink) | Excellent (Typer + Rich) | Excellent (Cobra + Bubble Tea) |
| Terminal dashboard | Ink (React in terminal) | Textual (terminal + web) | Bubble Tea (terminal only) |
| Web dashboard | Native (Express/Next.js) | Native (FastAPI + frontend) | Needs separate frontend |
| GitHub API | Octokit (first-party, full) | PyGithub (community, full) | go-github (Google, full) |
| Sub-issues/dependencies | Typed in Octokit | Supported in PyGithub | Supported in go-github |
| Agent frameworks | Mastra (TS), OpenAI Agents SDK (TS) | LangGraph, OpenAI Agents SDK, Claude Agent SDK | Limited |
| HITL maturity | Mastra (young), OpenAI Agents (solid) | LangGraph (excellent), OpenAI Agents (excellent) | N/A |
| Model flexibility | Mastra: multi-provider | LangGraph: any provider | N/A |
| Distribution | npm link/npx, single JS bundle | pipx/pip, PyInstaller | Single static binary |
| Skills integration | Native (skills are .md files, any SDK can use them) | Native | Native |

The stack decision should weigh: (1) which agent framework best fits the Factory's Line with human gates at chosen stages, (2) which dashboard approach (terminal vs. web) the Operator prefers, (3) whether model flexibility matters (LangGraph in Python wins here), and (4) whether the stronger GitHub story in Node/TypeScript offsets Python's richer agent ecosystem.
