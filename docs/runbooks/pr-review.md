# Pull request review

Every pull request in this repo, including ones opened by an AI agent, gets an independent, thorough, validated review before it is called ready or merged.

This is **process**, not a GitHub-enforced gate. The only ruleset on this repository, **Protect main and develop from deletion**, blocks branch deletion. It does not require reviews or passing checks. Private sibling repos cannot require those either on the current GitHub plan.

## What "independent" means

- The reviewer is not the same person or agent session that authored the change.
- Do not trust the PR description or earlier write-ups. Re-read the diff against the surrounding code.
- Re-run the relevant tests (for API work: `npm test` with the CI mock flags against a live server and MySQL). Check coverage-related claims against a fresh run, not a remembered number.
- Every finding should point at a file and a concrete behavior. Drop anything that cannot be shown in the code.
- If the review finds a real defect, fix it on the same branch with a normal follow-up commit. Do not force-push shared review branches.

## What to check

1. The change is necessary and matches the stated intent.
2. It actually fixes or adds the behavior it claims.
3. It does not introduce a new security problem (authz gaps, spoofable proxy headers, leaked secrets, overly broad error pages, tests that assert nothing).
4. It follows existing patterns (especially service injection — see [AGENTS.md](../../AGENTS.md)).
5. It is a sound fix overall, including tests and docs.

For security-sensitive work, also confirm that clients in [helpful-web](https://github.com/rherubin/helpful-web) and [helpful_mobile](https://github.com/rherubin/helpful_mobile) do not depend on fields or endpoints the change removes or tightens.

## Merge

Merge only when a human has asked for the merge, and only into the agreed target (`develop` for ordinary work; `main` only for a release PR). Prefer a merge commit for `develop` → `main`.
