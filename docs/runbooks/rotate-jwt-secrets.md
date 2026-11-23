# Rotate JWT secrets on Railway

Rotating `JWT_SECRET` or `JWT_REFRESH_SECRET` signs out every session in that environment as soon as the new deploy comes up. Tell users (or testers) before you do it.

## When to rotate

- A signing secret may have leaked (including historical values that were once in this public repo).
- A secret might still be one of the old public placeholders (`your-secret-key-change-in-production` / `your-refresh-secret-key-change-in-production`).
- Planned credential rotation.

The production and develop secrets were last replaced on **21 November 2026**. Railway only shows variable *names* in some views, so you cannot reliably compare the live value to a historical one; if there is any doubt, rotate.

## Steps

1. Generate two new independent values:

   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

2. In Railway, open the **Helpful API** project, then the `helpful-api` service, then the **production** environment → Variables.
3. Set `JWT_SECRET` and `JWT_REFRESH_SECRET` to the new values. Do not change other variables as part of a rotation.
4. Saving the variables triggers a redeploy. Wait for it to finish.
5. Repeat for the **develop** environment with a *different* pair of values (do not reuse production secrets).
6. Verify both environments with [deploy-verification.md](deploy-verification.md).
7. Confirm you can log in again with a known test account. Existing tokens from before the rotation must fail.

Never paste the new secret values into git, tickets, or chat logs. This repo is public.
