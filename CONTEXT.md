# AI Software Factory

The personal, single-operator system in this repo that turns raw work — ideas, bug reports, feature requests — into shipped web apps. It is a fork of the mattpocock engineering skills, and the web apps it produces (Products) live in sibling directories outside this repo.

## Language

**The Factory**:
The whole single-operator system living in this repo: the Line, the intake ramps, the fork's own machinery, and the docs that define them.
_Avoid_: Automation, the workshop, the setup

**The Line**:
The workflow the Factory runs, in order: sharpening → spec → tickets → implementation → review → ship. The subject of "how the factory works".
_Avoid_: The pipeline, the process

**Idea**:
Raw input from the Operator for a product or feature the Factory should produce. Enters the Factory through sharpening.
_Avoid_: Feature request, brainstorm

**Request**:
Incoming work the Operator did not create: bug reports and feature requests for existing Products. Enters the Factory through the intake ramp.
_Avoid_: Issue, ticket

**Intake ramp**:
The entry point for Requests: triage moves them from raw arrival to agent-ready work.
_Avoid_: Intake channel, inbox

**Product**:
A web app the Factory produces. Lives in its own sibling repo/directory, outside this repo, with its own tracker and harness.
_Avoid_: App, deliverable, project

**Operator**:
The single person who drives the Factory. Sole operator; no team-facing machinery.
_Avoid_: User, client, maintainer

**The Fork**:
The group of mattpocock engineering skills this Factory inherits and re-authors. The relationship defines what is already working (inherited) versus what the fork adds (own machinery).
_Avoid_: The skills, the library, upstream