# Release develop to main

Use this when promoting already-reviewed work from develop into production.

1. Confirm develop is the commit you intend to ship, and that CI on `develop` is green (`.github/workflows/ci.yml`).
2. Open a pull request **from `develop` into `main`**. Do not push to `main` directly.
3. Wait for CI on the release PR to pass.
4. Complete the independent review in [pr-review.md](pr-review.md) if it has not already been done on the commits being released.
5. Merge with a **merge commit** (not squash, not rebase). Squash would rewrite develop history on main and has caused branch-deletion surprises in the past.
6. Do not delete `develop`. Auto-delete on merge is off, and the **Protect main and develop from deletion** ruleset should block a deletion if someone tries.
7. Railway deploys `main` to production. Verify with [deploy-verification.md](deploy-verification.md).
8. Production deploys log everyone out only if JWT secrets changed; a normal code release does not rotate secrets.

Rollback is a revert PR or a follow-up fix PR through the same develop → main path. Do not force-push `main`.
