# Protect main and develop from deletion

- **Date:** 21 November 2026
- **Status:** Accepted

## Context

A release merge from `develop` into `main` deleted the `develop` branch because GitHub's "auto-delete head branches" setting was on (or behaved as on) for that merge. Restoring `develop` is painful and breaks every open PR.

## Decision

- Set `delete_branch_on_merge` to off on this repository.
- Add a repository ruleset named **Protect main and develop from deletion** that prevents deletion of `refs/heads/main` and `refs/heads/develop`. It does not require reviews or status checks.
- Keep the release process as a merge-commit PR of `develop` → `main`, and never delete `develop` afterwards.

## Consequences

Feature branches may still be deleted by hand. `main` and `develop` cannot. Required reviews remain a team process, not a GitHub gate. Private sibling repos cannot use rulesets on the current GitHub plan; they still have `delete_branch_on_merge` off.
