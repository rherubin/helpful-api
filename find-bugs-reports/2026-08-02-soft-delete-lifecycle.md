# Find-bugs report — 2026-08-02 (soft-delete / pairing lifecycle)

## Critical bugs found: yes (3 new)

Already tracked (not re-opened): PR #2 (soft-delete/restore IDOR), PR #4 (soft-deleted pairing still authorizes program access), PR #3 (FCM token ownership). Same-day push/admin findings are in `2026-08-02.md`.

### 1. Soft-delete permanently locks email / blocks recovery after token expiry

- **Location:** `models/User.js` (`getUserByEmail`, `softDeleteUser`), `services/AuthService.js` (`login`, `refreshToken`), `middleware/auth.js`, `routes/users.js` (`PATCH /:id/restore`)
- **Trigger:** Soft-delete account → wait for access token expiry (or attempt refresh) → try login / re-register / restore
- **Impact:** Permanent account + email lockout. Login excludes soft-deleted rows; UNIQUE email blocks re-register; restore requires a live JWT; no password-reset path
- **Root cause:** Soft-delete retained UNIQUE email without a credentials-based recovery path; refresh/login lookups ignored `deleted_at`
- **Fix:** Revoke refresh tokens on soft-delete; `POST /api/login` with correct password auto-restores (`data.restored: true`)

### 2. `max_pairings=1` bypass via leftover signup partner codes (+ restore)

- **Location:** `services/PairingService.js` (`acceptPairingByCode`), `models/Pairing.js` (`restorePairing`), signup auto-pending in `routes/users.js`
- **Trigger:** Alice + Bob sign up (each gets pending code). Alice accepts Bob’s code. Carol accepts Alice’s leftover signup code → Alice has 2 accepted pairings. Related: soft-delete pairing, rematch, restore old pairing also exceeded max
- **Impact:** Breaks one-pairing invariant; multi-partner state
- **Root cause:** Accept checked only acceptor’s count; leftover open partner-code invites were not invalidated; restore had no max check
- **Fix:** Enforce requester max on accept; soft-delete both members’ open partner-code invites after accept; block restore when a member is at cap or deleted

### 3. Any authenticated user could list all soft-deleted users/pairings

- **Location:** `routes/users.js` `GET /deleted/all`, `routes/pairing.js` `GET /deleted/all`
- **Trigger:** Any user JWT against those endpoints
- **Impact:** Mass PII disclosure (emails, names, pairing membership)
- **Root cause:** Auth-only, not admin-gated
- **Fix:** Require `req.user.type === 'admin'` (regular JWTs → 403)

### Also fixed while validating

Fresh-DB boot crash: `users` initialized before `org_codes`, breaking `users.org_code_id` FK. Init order corrected in `server.js`.

## Validation

- `TEST_MOCK_LLM=true npm run test:user-soft-delete` — 22/22 passed
- `TEST_MOCK_LLM=true npm run test:pairing-lifecycle` — 29/29 passed
