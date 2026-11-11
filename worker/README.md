# PANDORA atomic backup Worker

The `/sync` service stores the current backup and bounded revision history in a
SQLite-backed Cloudflare Durable Object. One authenticated namespace maps to one
object. The original `PANDORA_KV` namespace remains intact and is used to import
old records on first read. Existing JSON response bodies are unchanged.

This changes the server backup protocol. Publishing `novel.html` through GitHub
Pages **does not deploy this Worker**. The client must keep uploads disabled until
the deployed Worker advertises the atomic protocol.

## API contract

All routes require the existing `X-Auth` account token or `X-Sync-Token` legacy
passphrase. The outer Worker derives the storage namespace; caller-supplied
namespace headers are ignored. Responses use `Cache-Control: no-store`.

| Request | Result |
| --- | --- |
| `GET /sync/capabilities` | `{protocol:2, atomic:true, history:true, maxVersions:6, maxHistoryBytes:40000000, maxBodyBytes:20000000}` when the binding is present. Without it, `atomic` and `history` are false. |
| `GET /sync/list` | `{keys:[...], list_complete:true}`. All legacy KV pages and current Durable Object records are merged. Deleted records are omitted. An incomplete legacy list fails with HTTP 503. |
| `GET /sync/list?history=1` | `{keys:[...], list_complete:true, history:true}`. Read-only recovery picker listing: includes deleted saves that still have a retained non-deleted version, plus unmigrated legacy play saves. Only `save:<id>`, `slot1:<id>` through `slot3:<id>`, and `vn_slot_<id>_1` through `_3` are included. Connection settings, credentials, token counts and other keys are excluded. |
| `GET /sync?key=<key>` | Existing JSON body and an `ETag`, such as `"550e8400-e29b-41d4-a716-446655440000"`. A never-created key returns HTTP 404 with `ETag: "missing"`. A deleted key has its own tombstone revision. |
| `PUT /sync?key=<key>` | JSON body plus **exact** `If-Match` from the current GET. Success is `{ok:true, revision:<unquoted UUID>, bytes:<UTF-8 bytes>}` and a new `ETag`. An identical current body retains the old revision and adds `unchanged:true`. |
| `DELETE /sync?key=<key>` | The same exact revision requirement; creates a recoverable tombstone rather than deleting the original KV record. The current app does not automatically call this route. |
| `GET /sync/versions?key=<key>` | `{key, versions:[{revision,savedAt,deleted,bytes,current}], maxVersions:6}`. Newest first; no saved story body or credentials appear in this listing. |
| `GET /sync?key=<key>&version=<UUID>` | Read-only historical JSON. This never changes the current version. Historical PUT/DELETE are refused. |

Write errors:

- **428**: missing, wildcard, weak or malformed `If-Match`. Old clients that
  perform unconditional writes cannot overwrite a newer backup.
- **412**: the revision has changed. The current revision is exposed in `ETag`,
  but the client must stop automatic uploads and preserve its local data.
- **413**: the incoming body exceeds 20,000,000 UTF-8 bytes. The stream is bounded
  while receiving it, including requests without a Content-Length header.
- **503**: storage is unavailable or the atomic binding is missing. No fallback
  blind KV write is attempted.

Do not use a historical response's ETag as the current baseline. Restoring an old
revision requires an explicit user choice and should first import it into an
empty local slot. Existing local saves must remain untouched. A subsequent cloud
write must still obtain and match the **current** cloud revision.

Use `/sync/list?history=1` to populate the recovery picker, not the current-only
list. It reads key/version metadata without loading or importing legacy bodies.
Empty tombstones without a retained content version are omitted, and listing
history never revives pruned revisions. If atomic storage is not deployed, this
history listing fails with 503 rather than claiming a complete recovery list.

## Atomicity and retention

Revision comparison, new content chunks, the current pointer, and retention
changes are inside one synchronous SQLite transaction. There is no network await
between the comparison and commit. A delayed legacy read is rechecked inside the
transaction and cannot overwrite a record another request already imported or
changed. A failed write rolls back the revision, chunks and history together.

Each key retains up to **six versions including the current one**, with a
40,000,000-byte content budget. Older revision copies are pruned when either
limit is exceeded. The current revision is always retained. JSON is split into
small rows without cutting UTF-16 surrogate pairs, so large Korean and emoji
saves do not exceed the SQLite row limit or corrupt text. The untouched original
legacy KV record is additional migration protection, not an indefinitely current
replica.

Do not run old and new Worker code concurrently in a gradual rollout. Old code
still writes KV without revision checks. Complete the Worker replacement while
the application's cloud uploads are off, then verify capabilities and enable
backups deliberately. Legacy KV is eventually consistent, so allow in-flight old
writes to settle before the first import. Once new backups have been written,
do not roll the Worker back to the old KV-only implementation: those KV values
will be older. A frontend rollback may keep the new Worker safely; old
unconditional writes receive 428.

## Local verification

From the repository root, use Node.js 22.16 or newer:

```sh
node tests-sync-worker.js
```

The tests execute `sync.js` and `sync-store.js` against **real local SQLite
transactions** through the documented storage interface. They cover simultaneous
create/update races, an in-flight request body, delayed migration, stale writes,
history reads, recoverable deletion, transaction rollback, chunk boundaries,
namespace isolation, paginated lists, oversized bodies, CORS and authentication
configuration. KV and network are fixtures; these are not production Cloudflare
or paid-model tests.

A separate deployment build can be checked without publishing:

```sh
npx wrangler deploy --dry-run --keep-vars --config worker/wrangler.toml
```

## Deployment and credentials

`wrangler.toml` includes the `PANDORA_SYNC_STORE` binding and the additive
`pandora-sync-v2-sqlite` migration. It does not delete or rename any original KV
namespace, R2 bucket, or Durable Object class.

The repository has no automatic Worker deployment workflow. A Cloudflare session
or correctly scoped deployment token is required; do not paste it into code,
chat, build output, or this document. GitHub Pages success alone is not evidence
that this backend has been deployed.

Before deployment, confirm the existing Cloudflare account/Worker and verify that
its plan and usage limits meet the user's no-spend requirement. SQLite Durable
Objects are supported on the Workers Free plan. Free quota exhaustion fails
operations; a Workers Paid account can incur usage charges. Do not upgrade the
account or create paid resources without authorization.

Deploy only through an authorized existing session:

```sh
npx wrangler deploy --keep-vars --config worker/wrangler.toml
```

The `--keep-vars` flag is required here to preserve existing remote variables
while local private credentials are removed from tracked configuration. Existing
Worker secrets are also to be preserved. In particular:

- `AUTH_SECRET` is a Worker secret. The known `dev` fallback has been removed.
  Missing or empty configuration blocks account registration/login with 503 and
  rejects account tokens. Existing configured secret values and token lifetimes
  are unchanged; do not rotate this secret as part of an unrelated deploy.
- `VAPID_PRIVATE_JWK` is a Worker secret, not a repository variable. The private
  value was removed from the tracked config. Its earlier presence in Git history
  is not erased by this change; replacing that exposed push key requires a
  separately coordinated key/subscription migration. No key rotation was
  performed by this patch.
- `VAPID_PUBLIC` and `GOOGLE_CLIENT_ID` are public identifiers and remain in the
  config. No account credentials are placed in this document.

After deploying, use an authenticated app session to verify protocol readiness,
then use a disposable test key to verify two writes with the same ETag yield one
success and one 412, and that the prior version is readable. Do not use a user's
real save to test destructive operations. Until this verification is complete,
report the server deployment status separately from local tests and keep real
cloud uploads off.

## Official references

- [SQLite-backed Durable Object storage and transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object configuration and class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Durable Object pricing and Free-plan behavior](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Object storage and row limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
