# Deploy verification and health checks

Railway auto-deploys:

- `main` → production — https://helpful-api-prod.up.railway.app
- `develop` → develop — https://helpful-api-dev.up.railway.app

After a deploy (or a variable change, which also redeploys):

```bash
curl -sS https://helpful-api-prod.up.railway.app/health
# expect: OK

curl -sS https://helpful-api-prod.up.railway.app/health/diagnostics
# expect: {"ok":true}
```

Use the `helpful-api-dev` host for a develop deploy.

`/health` is plain text and is what Railway liveness should hit. `/health/diagnostics` is JSON and must stay limited to `{"ok":true}` — it must not report `TEST_MOCK_*` or other internals.

A successful production smoke after a security or auth change should also confirm:

- A bad password still returns an error (not a 5xx).
- The web app at sittogether.org can still call the API (CORS). If `CORS_ORIGIN` is set, confirm those origins succeed and others are refused.

The root path `GET /` returns plain text `Helpful API is running`.
