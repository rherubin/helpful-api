# Security checks

Automated security scanning for this repository. It uses open tools that run
in GitHub Actions, so nothing depends on an editor or a vendor account. The
workflows are `.github/workflows/security-checks.yml` and
`.github/workflows/codeql.yml`.

## What runs

| Check | Tool | Runs on | Fails the run when |
|---|---|---|---|
| Secret scan | [gitleaks](https://github.com/gitleaks/gitleaks) | Pull requests, pushes to `develop` and `main`, weekly, manual | A commit in the pull request or push adds a secret, or any file in the working tree contains one |
| Dependency audit | `npm audit` | Same triggers | A production dependency has a **high** or **critical** advisory |
| Code scanning | [CodeQL](https://codeql.github.com/) (`javascript-typescript`) | Same triggers | The analysis itself fails. Findings appear as alerts, not as a failed run |

Details that matter:

- **Secret scan scope.** On a pull request or push it scans only the new
  commits, so old history never blocks work. A second step scans the files as
  checked out, so a secret already sitting in the tree is still caught on the
  weekly run. Output is redacted; secret values are never printed to the log.
- **Dependency audit scope.** The gate covers production dependencies only,
  because dev-only packages never ship. A second, informational step lists
  every advisory including dev dependencies. It never fails the run.
- **CodeQL** is free here because the repository is public. Open alerts are on
  the repository's **Security** tab, under **Code scanning**. Pull requests
  from forks are skipped, because their token cannot upload results.
- The weekly schedule exists because new advisories are published against code
  that has not changed.

## Run the checks locally

```bash
# Secrets (install gitleaks from https://github.com/gitleaks/gitleaks/releases)
.github/scripts/gitleaks-scan.sh tree
.github/scripts/gitleaks-scan.sh range origin/develop HEAD

# Dependencies
npm audit --package-lock-only --omit=dev --audit-level=high
npm audit --package-lock-only
```

## Handling a finding

### A secret was found

1. **Treat it as exposed.** It is in git history even if you delete the file.
   This repository is public, so assume it was already copied.
2. **Rotate it first**: issue a new value in the service that owns it and
   deploy the new value. Do not wait for the cleanup.
3. Remove it from the code and load it from the environment instead.
4. Only then consider rewriting history. Rotation is what makes it safe.
5. If the finding is **verified** not to be a live secret (a documented
   example, a test fixture, a public key by design), add the narrowest
   allowlist to `.gitleaks.toml`: a specific `regexes` entry or a single path
   plus `targetRules`. Write why in `description`. Never allowlist a whole
   rule or directory to get a run green.

### A dependency advisory was found

1. Read the advisory: is the vulnerable code reachable in production?
2. Prefer upgrading. `npm audit` shows the fixed version. For a transitive
   dependency, upgrade the direct dependency that pulls it in.
3. If the fix is a breaking change, open a separate pull request for it and
   run the full test suite.
4. If no fix exists yet, note the advisory ID in the pull request and re-check
   weekly. Do not hide it.

### A CodeQL alert was found

Open it from **Security > Code scanning**. Fix the code, or dismiss it in the
GitHub UI with a reason (false positive, used in tests, won't fix). A dismissal
is recorded with who made it and why.

## Changing these workflows

Follow [ci-workflow-changes.md](ci-workflow-changes.md): run `actionlint`,
confirm every job actually starts (including the scheduled and manual ones),
keep `permissions` minimal, and pin third-party actions to full commit SHAs.
Tool downloads are pinned to a version and verified against a SHA-256 checksum
before they run; update the version and the checksums together.

## Known gaps

- Dependabot alerts are a repository setting and are enabled in GitHub under
  **Settings > Advanced Security**, not by a workflow. Dependabot version
  updates are configured in `.github/dependabot.yml`: weekly (Monday 09:00
  America/New_York), one grouped PR per ecosystem (npm, GitHub Actions) into
  `develop`. Each of those PRs runs CI.
- The secret scan has no `paths-ignore`, so it runs on docs-only changes too.
  Every push gets its own scan: push, scheduled and manual runs each have
  their own concurrency group, so none is cancelled or skipped by a later
  run. This matters because a push scan covers only the commits that push
  added. On a pull request, a newer commit cancels the older scan, and the
  newer one covers the whole PR.
- `npm audit` only knows advisories in the GitHub advisory database.
- Not covered: infrastructure and runtime configuration (Railway, DNS,
  environment variables).
