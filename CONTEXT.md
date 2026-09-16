# AI Software Factory

The personal, single-operator system in this repo that turns raw work — ideas, bug reports, feature requests — into shipped web apps. It is a fork of the mattpocock engineering skills, and the web apps it produces (Products) live in sibling directories outside this repo.

## Language

**The Factory**:
The whole single-operator system living in this repo: the Line, the intake ramps, the fork's own machinery, and the docs that define them.
_Avoid_: Automation, the workshop, the setup

**The Line**:
The workflow the Factory runs, in order: sharpening → spec → tickets → implementation → review → ship. The subject of "how the factory works".
_Avoid_: The pipeline, the process

**Line run**:
One effort's pass down the Line, from Idea to ship or halt — the unit of work the Factory drives, backed by one workflow run and keyed by its tracker issue.
_Avoid_: The job, pipeline run

**Line position**:
A Product Line's current place in the Line — read, never stored, from what is already true: the live run's suspension point and the tracker's open issues and labels.
_Avoid_: Status, progress, stage field

**Idea**:
Raw input from the Operator for a product or feature the Factory should produce. Enters the Factory through sharpening.
_Avoid_: Feature request, brainstorm

**Request**:
Incoming work the Operator did not create: bug reports and feature requests for existing Products. Enters the Factory through the intake ramp.
_Avoid_: Issue, ticket

**Intake ramp**:
The entry point for Requests: triage moves them from raw arrival to agent-ready work.
_Avoid_: Intake channel, inbox

**Tracker**:
The canonical record of a Line's work: GitHub Issues — tickets, labels, and blocking — living in the repo that owns the Line (this repo for the Factory, a Product's repo for that Product). What issues can't express (agent run-states, config, credentials) lives in the Factory's thin local store.
_Avoid_: The backlog, the dashboard view

**Product**:
A web app the Factory produces. Lives in its own sibling repo/directory, outside this repo, with its own tracker and harness.
_Avoid_: App, deliverable, project

**Operator**:
The single person who drives the Factory. Sole operator; no team-facing machinery.
_Avoid_: User, client, maintainer

**The Fork**:
The group of mattpocock engineering skills this Factory inherits and re-authors. The relationship defines what is already working (inherited) versus what the fork adds (own machinery).
_Avoid_: The skills, the library, upstream
_Not to be confused with_: a **fork report** (below) — the unbriefed-stop report a driven stage raises.

**Fork report**:
The report a driven stage posts when it hits a decision it wasn't briefed to make: what it was asked to decide, what it found, the options it can see with their consequences, and its recommendation. The stage forks — suspends the run and awaits an option-pick through the Surface.
_Avoid_: escalation, question

**Surface**:
The face of the Factory the Operator drives. In v1, the terminal session — a thin `factory` CLI and the agent sessions the skills already inhabit. A web dashboard is deferred.
_Avoid_: dashboard, console, UI

**Drive**:
The default stance of a Line stage: the Factory runs it on its own and reports, never stopping for the Operator. Sharpening, tickets, implementation, and ship drive; spec and review are the exceptions — they Gate.
_Avoid_: automation, hands-off, full-auto

**Gate**:
A Line boundary where the Line stops and waits on an explicit Operator decision before advancing. The Factory's v1 gates sit at the end of spec and at review.
_Avoid_: checkpoint, approval step, milestone

**Disposition**:
The Operator's call at a gate. At the review gate it is one of advance (ship), revise (send the Line back with the revision), or halt (the Product is off-track for a reason beyond code).
_Avoid_: verdict, decision, sign-off

**Review bar**:
The concrete floor a Product must clear to advance past the review gate: green automated checks (typecheck, lint, build, tests), a reviewer's checklist verified against the spec, and the Operator seeing the running app. Advance is only offered on a green bar; a red bar offers revise or halt instead.
_Avoid_: quality gate, acceptance criteria

**Stage report**:
What a driven stage leaves behind on the Line's current tracker issue — the durable record of a driven stage's outcome (the spec at the spec gate, the ticket list, an implementation summary, the reviewer's checklist). The day brief digests it.
_Avoid_: status update, log