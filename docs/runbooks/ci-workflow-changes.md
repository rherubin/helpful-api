# CI workflow changes

Changing a GitHub Actions workflow can break jobs that regular test CI never
runs, such as `workflow_dispatch` release pipelines. A parse error fails
those runs in about 0 seconds with "This run likely failed because of a
workflow file issue," while the pull request's test CI stays green.

The `workflow-lint` workflow runs [actionlint](https://github.com/rhysd/actionlint)
(with ShellCheck) on pull requests and on pushes to `develop` and `main`
when files under `.github/workflows/` change.

## Checklist

1. **Run actionlint locally** before opening a pull request.

   Install it from the [actionlint install guide](https://github.com/rhysd/actionlint/blob/main/docs/install.md),
   install [ShellCheck](https://www.shellcheck.net/), and from the repo root
   run:

   ```bash
   actionlint
   ```

   Fix every error it reports. CI uses actionlint v1.7.12 and fails the job
   on findings.

2. **Confirm manually triggered workflows still parse.** After changing
   anything under `.github/workflows/`, open the repository's Actions tab
   and check that workflows which do not run on the pull request
   (especially release pipelines) are not failing instantly (0s) with a
   workflow file issue. Green test CI is not enough.

3. **For security hardening** (permission tightening, action pinning,
   untrusted-input changes), verify every touched workflow file, including
   ones that do not run on the pull request. Do not rely only on green CI.
