# Repo-native docs for humans and any AI tool

- **Date:** 22 November 2026
- **Status:** Accepted

## Context

Project conventions, test rituals, and operational learnings lived in chat memory and in Cursor-only files (`.cursor/rules/*.mdc`, `.cursor/automations/*`). Engineers and AI tools that do not use Cursor could not see them. Cursor is no longer the team's editor.

## Decision

- Make [AGENTS.md](../../AGENTS.md) the canonical contributor and agent guide, with `CLAUDE.md` as a one-line pointer to it.
- Store runbooks, decision records, and learnings under `docs/`, versioned on the same branches as the code.
- Merge the former Cursor rules (service injection, high-pressure test template, API restart for large testing) into `AGENTS.md` and `docs/runbooks/`, then remove `.cursor/rules/`.
- Keep `.cursor/automations/` because those files describe a scheduled Find Bugs job. Flag them in [../runbooks/find-bugs-automation.md](../runbooks/find-bugs-automation.md) until the job is re-hosted or retired.

## Consequences

Changes to how we build, test, release, or operate the API are documented in-repo via pull requests, not only in a single assistant's memory.
