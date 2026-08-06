# Find Bugs automations — manual setup

Chat → Automations prefill is currently unreliable. Use these values in **Cursor → Automations → New**.

Also complete **Cloud Agents → Start Setup** and connect GitHub + Slack before expecting runs.

## Shared settings

| Field | Value |
|-------|--------|
| Trigger | Scheduled / cron: `0 13 * * *` (9:00 AM Eastern during EDT) |
| Tools | Send to Slack; Memories enabled |
| Report path | `find-bugs-reports/YYYY-MM-DD.md` (UTC date) |

## 1) Find Bugs — helpful-api

| Field | Value |
|-------|--------|
| Name | Find Bugs — helpful-api |
| Repo | `rherubin/helpful-api` |
| Branch | `develop` |
| Slack | `C0BKT9831C5` (API bug reports) |
| Instructions | Copy the `prompt` string from `find-bugs-helpful-api.json` |

## 2) Find Bugs — helpful-web

| Field | Value |
|-------|--------|
| Name | Find Bugs — helpful-web |
| Repo | `rherubin/helpful-web` |
| Branch | `develop` |
| Slack | `C0BKQA8T6R1` (web bug reports) |
| Instructions | Copy the `prompt` string from `../helpful-web/.cursor/automations/find-bugs-helpful-web.json` (or the sibling file in that repo) |

Save and **enable** each automation after creating it.
