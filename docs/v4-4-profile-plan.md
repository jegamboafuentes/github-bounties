# V4-4 Profile and settings parity (plan)

Status: approved and implemented on this branch. The request and response shapes below are the short form. `docs/api.md` is the operator reference.

This slice adds Bearer-key reads and writes for the signed-in user's display name and email notification preferences, plus a read-only linked-accounts view. Wallet add/change, GitHub link/unlink, and email address changes stay on the session Settings page. The 2% fee, the 15% pool, money paths, the retired claim-lock, agent-owned accounts, and BTC are out of scope.

## Endpoints

| Method | Path | Scope | Rate class |
| --- | --- | --- | --- |
| GET | `/api/v1/me/profile` | read | read (120/min) |
| PATCH | `/api/v1/me/profile` | write | write (20/min) |
| GET | `/api/v1/me/notification-preferences` | read | read |
| PATCH | `/api/v1/me/notification-preferences` | write | write |
| GET | `/api/v1/me/linked-accounts` | read | read |

MCP tools become 24 (up from 19): `get_profile`, `update_profile`, `get_notification_preferences`, `update_notification_preferences`, `list_linked_accounts`.

OpenAPI operations become 23 (up from 18): `getProfile`, `updateProfile`, `getNotificationPreferences`, `updateNotificationPreferences`, `listLinkedAccounts`.

## Decisions

- Display name is 1–80 Unicode code points after trim, with no C0 controls and no `<` or `>`. Saving a name sets `users.display_name_custom` so the next Google sign-in does not overwrite it.
- Email preferences are a new 1:1 table, `user_notification_preferences`. A missing row means all four bounty emails stay on. `welcome` is not toggleable. Enqueue and deliver both honor the flags. No USDC movement.
- Linked accounts return GitHub login, id (decimal string), and `linkedAt`; the Google email as Settings shows it (full, not masked); and the saved wallet address, read-only. No link or unlink route.
- A wallet or payout-address field on either PATCH body returns 400 `wallet_change_human_only`. Any other unknown field returns 400 `validation_failed`.
- PATCH does not require `Idempotency-Key`. That matches create and work-signal, not cancel, fund, claim, or refund.
- Migration `0012_profile_notification_prefs`, journal idx 12, `when` `1790600000000`. Additive. DEV must apply it before the new code reads the table. No new environment variables.

Request and response shapes, error bodies, the SQL sketch, Settings UI, tests, rollout, and open questions are in the pull request description.
