# Find Bugs daily scan (Cursor automation)

This repo still contains Cursor Automation definitions used for a daily high-severity bug scan:

- `.cursor/automations/find-bugs-helpful-api.json` — prompt, cron, and Slack action
- `.cursor/automations/FIND-BUGS-SETUP.md` — how the automation was registered in Cursor

The schedule is `0 13 * * *` (13:00 UTC). The automation writes `find-bugs-reports/YYYY-MM-DD.md` and is configured to post to Slack channel `C0BKT9831C5`.

These files were **kept** rather than removed with the rest of `.cursor/`, because they describe a scheduled job, not just editor rules. The job itself runs in Cursor Cloud Automations, not GitHub Actions. If Cursor is no longer in use, this scan will not run until it is re-hosted (for example as a GitHub Actions workflow). Confirm in Cursor whether the automation is still enabled before assuming reports will appear.

`.github/workflows/mark-agent-prs-ready.yml` marks draft PRs whose branch starts with `cursor/` as ready for review. Leave that workflow in place while any Cursor automation might still open PRs.

A sibling automation exists in [helpful-web](https://github.com/rherubin/helpful-web) (Slack `C0BKQA8T6R1`).
