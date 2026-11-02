# Local artifact archive primitive

`LocalArtifactArchive` is inert: importing or constructing it does no I/O and
registers no provider, module, worker, export, cron, route, or recovery process.
It depends only on the reviewed domain evidence helpers and Node filesystem /
crypto APIs. No database schema or receipt writer is involved.

## Contract

Construct with an explicit `rootPath`, independently verified `expectedDevice`
and `expectedInode`, and a safe nonnegative integer `maxBytes`. There is no default
root, root creation, or fallback. `archive(fullArtifactClaim, byteStream)` validates
the whole plain claim with the canonical guards and copies its five required
fields before its first await. It recomputes `artifactIdentity`; an extra supplied
`artifactId` cannot select a filename. Extra canonical fields are ignored after
validation and never returned, logged, or persisted. Identifiers remain in memory.

The stream must yield `Uint8Array` / Buffer chunks. The declared size must fit
`maxBytes`; excess bytes are rejected before writing that chunk. Streaming SHA-256
and exact byte length must match the claim, and the temporary file is read back
and verified with a fixed 64 KiB buffer. Writes copy at most 64 KiB at a time and
handle partial writes. There is no full-artifact buffer. The caller owns limits
on stream duration, concurrent calls and upstream allocation; this primitive
cannot bound a stalled producer or memory the producer already allocated.

Layout is flat: `<computed-lowercase-hex-artifact-id>.bin`. Each attempt creates
one unpredictable, exclusive `.archive-<random>.tmp` in the root with mode 0600
(subject to a stricter process umask). It verifies and fsyncs the temporary file,
then publishes using a same-filesystem hard link. Ordinary overwriting rename is
never used. `EEXIST` triggers actual existing-file hash / size verification and
file fsync. Conflicting or corrupt entries are left untouched. The attempt's own
temporary entry is removed and the directory is fsynced before success. Retry
and concurrent identical attempts are safe under the trust assumptions below.

Success is a frozen object with only `ok`, `artifactId`, `relativeKey`,
`contentSha256`, `byteLength`, and `disposition: created | reused`. Failure is a
frozen `{ ok: false, error: INVALID_INPUT | ARCHIVE_FAILED }`; low-level causes,
absolute paths, raw identifiers and payloads are not returned or logged. The
optional synchronous fault hook names only write, file-sync, publish,
directory-sync and cleanup stages; it is a deterministic test seam, not a runtime
integration point, and must not be supplied by untrusted code.

## Filesystem trust and durability limits

This is a POSIX filesystem primitive requiring `O_NOFOLLOW`, exclusive creation,
hard links and working file/directory fsync. Unsupported operations fail closed.
Every archive operation revalidates the canonical absolute root and its expected
device/inode, including around reads, writes, publication and cleanup. Every root
ancestor must be a real directory owned by UID 0 or the service UID, with no group
or other write permission. Symlinks and nonregular artifact entries are rejected;
nonblocking/no-follow opens avoid following a symlink or blocking on a FIFO.
Existing files must also be owned by root or the service UID and must not have
group/other write permission, preventing reuse of untrusted writable bytes.
The root itself must already exist. A missing, replaced or mismatched root yields
no success and is never created. A world-writable ancestor, including `/tmp`, is
not accepted even when it has the sticky bit.

Administrators must independently establish the expected identity and validate
the actual server mount, ownership, permissions, ACLs, filesystem semantics and
storage guarantees before operational use. The service UID and administrators
are trusted; ACLs or other mechanisms must not grant untrusted mutation access.
Node pathname checks cannot guarantee security against races through a hostile
writable ancestor or a privileged process changing the namespace between checks.
The device/inode pair is a checked expectation, not a mount attestation or defense
against inode reuse by an administrator. API immutability means this primitive
never overwrites an existing final object; it is not hardware tamper protection.

If publication succeeds but later cleanup, directory fsync, validation or close
fails, the call returns no success and retains the uncertain final object. Retry
must verify the file again and perform the required sync. Cleanup only targets
this attempt's exclusively created temporary inode after rechecking root and
inode ownership. If that ownership cannot be established, cleanup fails closed.
Process death or cleanup failure can leave temporary files; no garbage collection
or recovery worker is included. Failure is not a claim that nothing was written.

These local facts are not a durable receipt ledger, a proof of provider source,
a bundle consistency verdict, company completeness, or backup completion. Real
provider documents and deployed host filesystem validation are outside this unit.
The hermetic tests use synthetic bytes and private temporary directories under
the test user's home because `/workspace` on the implementation host has a
world-writable ancestor; each test removes only its own generated directory.

# Local backup worker (BJJ-455)

The worker copies the BJJ-454 export snapshot into a local archive and keeps a
checksummed ledger of what it did. It has no database, no Nest context and no
environment variables: one JSON configuration file, one token file, two
directories. It is a command line tool; scheduling and the real host paths are
BJJ-457, not this unit.

BJJ-456 adds an optional second, independent destination: a Google Drive folder
that mirrors the archive. It is switched on by a `drive` block in the configuration
and two more secret files, and is described under "Google Drive destination" below.
A configuration without a `drive` block behaves exactly as described for the local
archive alone.

## Running it

Every command except `inspect` must run while the process holds
`<control>/worker.lock`. Use `flock -F` so the lock belongs to the node process
itself, which the worker verifies against `/proc/locks`:

    cd backend && NODE_PATH=. flock -n -F -E 75 <control>/worker.lock \
      node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts \
      run --config <abs path to worker.json>

`flock` exits 75 when another worker holds the lock; treat that as "skipped,
overlapping run", not as a failure.

`flock` itself creates `<control>/worker.lock` when it is missing, with the process
umask (a `0666` file minus the umask, so often group- and world-readable); the worker
never creates it. What keeps other users away from it is the control directory, which
should be `0700` (owner only) and owned by the worker user. The worker enforces only that it is
not writable by group or others, which still lets other users traverse it and read the lock
file, so set `0700` yourself. If the control directory does not exist, `flock` fails by itself with exit 66
(`EX_NOINPUT`) and a path on stderr before the worker runs; the worker's own
`lock-not-held` (78) is what a worker started without `flock` reports.

| command | what it does |
| --- | --- |
| `init` | first install only: archive marker, control marker, first ledger record |
| `run [--scheduled-for <ISO+offset>]` | finishes interrupted work, then one snapshot: download, publish, verify, manifests, completion |
| `verify [--all]` | re-hashes verified artifacts (default: older than 7 days); damaged ones are renamed aside and recorded as `integrity_error`. With `--all` it also reads every bound manifest (acknowledged by the ledger or named by a completion) and exits 69 `archive-conflict` if one is missing, is no valid manifest of its document, or has another digest than the ledger or a completion binds (the run's `run_finished` record carries `archive-conflict`). It never repairs or rewrites a manifest, but it still moves damaged PDFs aside and writes ledger records. With a `ready` Drive binding it also rechecks the Drive copies, see "Checking Drive with `verify`" |
| `recover --installation-id <id> [--drive-root-folder-id <id>]` | rebuilds a damaged ledger from the archive; see below. With a `drive` block it then adopts the existing Drive root, see "Recovery with Drive" (the flag is accepted only here and picks the Drive root) |
| `drive-setup [--rebind]` | binds the Google Drive root folder of this installation (resumable); `--rebind` binds a new root. Needs a `drive` block, see "Binding the Drive root: `drive-setup`" |
| `inspect` | read-only report of the ledger; needs no lock |

`drive-setup` runs under the lock like `run` and ignores `"enabled": false`. A separate tool,
`restore-drive`, copies the Drive tree into an empty directory and needs neither the lock nor the
ledger; see "`restore-drive`: the archive from Drive alone".

With `"enabled": false` the commands `run`, `verify` and `recover` print
`{"event":"disabled"}` and do nothing (no lock, no ledger, no network).

stdout is one JSON object per line with keys from `event`, `runId`,
`reasonCode`, `counts`; `drive-setup` adds `rootFolderId` and `destinationRevision`
(`drive_bound`), and `recover` adds `candidates` (`recover_drive_root_ambiguous` only).
stderr is a reason code and nothing else, so no token, path
or provider message reaches a log. The exit codes of the worker and of restore are
listed under "Exit codes" below.

A run ends as `partial` at best, because the archive can prove its own bytes but
not that nothing is missing. `blocked` means the run could not take everything it
was offered: the archive side refused (`archive-unavailable`, `archive-space`,
`archive-conflict`, ...), the control side had no room to stage (`control-space`),
a download was refused outright (credential rejected), or at
least one included candidate was refused (`invalid-path-segment`,
`export-response-invalid`, `artifact-too-large`). Only included candidates count;
an excluded one never changes the status. Documents gone at the source
(`source-removed`, `exact-bytes-unavailable`) are gaps, reported as
`known_gap` coverage, not as `blocked`. `failed` means no usable snapshot.
Reason codes in the run record say why. A run with no `ready` Drive binding (no `drive`
block, or `drive-setup` never finished) always lists `drive-not-configured` among them; a
bound Drive replaces that code by its own, see "What `run` does with two destinations".

A completion lists every document the snapshot includes but the completion does not
contain as a gap, with the reason: `archive-conflict` when a manifest of the document
conflicts, `ledger-inconsistent` when the ledger's evidence for it cannot be proven,
the refusal itself when its manifest could not be written, the check that blocked the
candidate (a candidate whose document id is not a valid id cannot be named in a
completion; only the run record's reason codes report it), or, while its pair is not complete, the reason the ledger holds for the
artifact that is not verified (for example `export-unavailable`, `artifact-pending`,
`artifact-integrity`). An included document the source offered with no artifacts at all
is listed as `artifact-pending`. If every included document of a snapshot is omitted, the
completion still gets published, with no entries and those gaps, so `restore --latest`
selects it, reports the gaps and restores nothing; to restore the documents an earlier
completion holds, run restore with `--snapshot <that snapshot id>` instead. On a first
run where no document has a complete pair yet, this gap-only completion also means
`--allow-incomplete` does not apply (it is only used when no completion exists). The gaps appear in
`restore-report.json`, so `--latest` never leaves a document out silently. A document that
is no longer in the snapshot is not a gap of it.

Only permanent gaps (`source-removed`, `exact-bytes-unavailable`: the bytes are gone at the
source) are historical coverage. `recover` brings back only those from the completions as
known gaps; every other reason says why one snapshot lacked a document and a later run can
still resolve it, so it stays in that completion and is not imported.

## worker.json

One JSON file, passed as `--config <abs path>`, read once at start. It is strict:
an unknown field (top level or inside `control` / `archive` / `drive`), a wrong type or a
missing required field is `config-invalid`. No environment variable is read. A
disabled worker (`"enabled": false`) still has its file validated first.

| field | type | constraint | default |
| --- | --- | --- | --- |
| `schemaVersion` | number | exactly `1` | required |
| `enabled` | boolean | `false` turns `run`, `verify` and `recover` into no-ops | `false` |
| `companyId` | string | one path segment: starts with a letter or digit, then letters, digits, `_` `.` `:` `-`; at most 256 characters and 255 UTF-8 bytes; not `.` or `..` | required |
| `exportBaseUrl` | string | 1 to 2048 characters; `https:`, or `http:` only for host `127.0.0.1`, `localhost` or `[::1]`; no user name, password, query or fragment | required |
| `tokenFile` | string | normal absolute path (see below); must not be inside `archive.path` | required |
| `control.path` | string | normal absolute path | required |
| `control.reserveBytes` | integer | 64 MiB (67108864) to 9007199254740991 (`Number.MAX_SAFE_INTEGER`) | required |
| `control.reserveInodes` | integer | 1000 to 9007199254740991 (`Number.MAX_SAFE_INTEGER`) | required |
| `archive.path` | string | normal absolute path | required |
| `archive.archiveId` | string | lowercase UUID (`8-4-4-4-12` hex digits) | required |
| `archive.reserveBytes` | integer | 64 MiB (67108864) to 9007199254740991 (`Number.MAX_SAFE_INTEGER`) | required |
| `archive.reserveInodes` | integer | 1000 to 9007199254740991 (`Number.MAX_SAFE_INTEGER`) | required |
| `archive.requireMountPoint` | boolean | `true`: the archive root must be a mount point (its device differs from its parent's) | `true` |
| `requestTimeoutMs` | integer | 1 to 600000 | `120000`; for the JSON requests (snapshot, candidates) a total deadline for the whole request; for an artifact download a deadline for the response headers plus an idle timeout for each body read, with no total deadline (see below) |
| `drive` | object | optional; strict, see "The `drive` block" below | absent: no Drive destination |

`requestTimeoutMs` is not a limit on how long a run takes. Each JSON request (snapshot,
candidates) must finish within it. For an artifact download it bounds only the wait for
the response headers, and each single read of the body (the
timer restarts after every chunk). The worker sets no total deadline for the body, so a
server that keeps sending a few bytes inside each idle window can hold one download,
and so the run and its `flock`, for a long time. While it does, every later scheduled
run exits 75 (skipped, overlapping run). The worker does not bound the run itself.
Recommendation for the BJJ-457 install: bound each run from outside, for example with
a systemd service limit such as `RuntimeMaxSec=`. That is a recommendation for the
installer, not something the worker enforces.

A *normal absolute path* starts with `/`, is not `/` itself, is at most 4096
characters, has no trailing slash and no empty, `.` or `..` segment, and contains no
NUL. `control.path` and `archive.path` must not be equal or contain each other. The
reserves are checked against the filesystem's free space (blocks available to
non-root users) and free inodes, before a write:

- Archive check or write (the incoming byte count is 0 for a plain check): the free bytes must be
  at least the incoming bytes plus `archive.reserveBytes`, and the free inodes must be
  strictly more than `archive.reserveInodes`. Otherwise `archive-space`.
- Control staging (room for a download): the same test with the artifact size and the
  full `control.reserveBytes` and `control.reserveInodes`. Otherwise the artifact is
  recorded as blocked with `control-space`.
- Control ledger (checked before each run and before each transfer): the free bytes
  must be at least a quarter of `control.reserveBytes` (rounded down), and the free
  inodes strictly more than a quarter of `control.reserveInodes` (rounded down).
  Otherwise `control-space`. So the ledger is still allowed to write when the
  control filesystem is below the full reserve, as long as that quarter is free;
  staging stops first. The full reserve is not guaranteed to remain free after every
  write.

Minimal example (placeholder values only):

    {
      "schemaVersion": 1,
      "enabled": true,
      "companyId": "example-company",
      "exportBaseUrl": "https://backup.example.test/internal/eformsign-backup/v1",
      "tokenFile": "/path/to/secrets/export.token",
      "control": { "path": "/path/to/control", "reserveBytes": 1073741824, "reserveInodes": 10000 },
      "archive": {
        "path": "/path/to/archive",
        "archiveId": "00000000-0000-0000-0000-000000000000",
        "reserveBytes": 1073741824,
        "reserveInodes": 10000
      }
    }

### The `drive` block

Optional. With it the worker can keep a second copy of the archive in Google Drive (see "Google
Drive destination"). Strict like the rest of the file; every field outside this table is
`config-invalid`.

| field | type | constraint | default |
| --- | --- | --- | --- |
| `drive.clientFile` | string | normal absolute path; must not be inside `archive.path` or `control.path` (nor equal to either) | required |
| `drive.refreshTokenFile` | string | normal absolute path; same placement rule | required |
| `drive.tokenUrl` | string | 1 to 2048 characters; `https:`, or `http:` only for host `127.0.0.1`, `localhost` or `[::1]`; no user name, password, query or fragment (the rule of `exportBaseUrl`) | `https://oauth2.googleapis.com/token` |
| `drive.apiBaseUrl` | string | same rule | `https://www.googleapis.com` |
| `drive.uploadBaseUrl` | string | same rule | `https://www.googleapis.com` |
| `drive.rootFolderName` | string | 1 to 255 characters, none of them a control character (U+0000 to U+001F, U+007F) | `bjj-eformsign-backup` |
| `drive.chunkBytes` | integer | at least 262144 and a multiple of 262144 (256 KiB), the size of one resumable upload chunk | `8388608` (8 MiB) |
| `drive.requestTimeoutMs` | integer | 1 to 600000 | the top-level `requestTimeoutMs` |

The three URLs default to Google's real endpoints; override them only for a test double on the
loopback address. `rootFolderName` is the name given to the Drive folder `drive-setup` creates.
`drive.requestTimeoutMs` is the deadline of one Drive or OAuth request; the body of a Drive
download has, like an export download, no total deadline but an idle timeout of the same length
for each read.

Placeholder example (the `drive` block next to the fields of the example above):

    "drive": {
      "clientFile": "/path/to/secrets/drive-client.json",
      "refreshTokenFile": "/path/to/secrets/drive-refresh-token",
      "rootFolderName": "bjj-eformsign-backup"
    }

### Ownership and mode rules

Every refusal below is a reason code only; the path is never printed.

- **Config file** (`--config`): a regular file, not a symlink (it is opened without
  following links), owned by the user running the worker, not writable by group or
  others, at most 64 KiB. It does not have to be 0600: 0644 and 0400 are accepted.
  Otherwise `config-invalid` (exit 78).
- **Token file** (`tokenFile`, read by `run` only): a regular file, not a symlink,
  mode exactly 0600, owned by the user running the worker, at most 256 bytes. The
  content is `ebx_` followed by 43 characters from `A-Z a-z 0-9 _ -`, with at most
  one trailing newline. Otherwise `token-file-invalid` (exit 78).
- **Drive secret files** (`drive.clientFile` and `drive.refreshTokenFile`; read by `run`,
  `drive-setup`, `recover`, `verify` and `restore-drive`, never by `init` or `inspect`): each a
  regular file, not a symlink, mode exactly 0600, owned by the user running the worker.
  `clientFile` is at most 4096 bytes of one JSON object with exactly the two non-empty
  string fields `client_id` and `client_secret` (each at most 512 characters) and nothing
  else. `refreshTokenFile` is at most 1024 bytes: one line of 20 to 512 characters from
  `A-Z a-z 0-9 _ - / .`, with at most one trailing newline. Otherwise `token-file-invalid`.
  It ends `drive-setup` and `restore-drive` (exit 78). `run`, `verify` and `recover` do not stop for it: the
  local work goes on and the Drive part reports `token-file-invalid` instead (`run`: a
  `partial` run with that reason; `verify`: that reason on its `run_finished` record; `recover`:
  the local ledger is rebuilt, then it exits 78 unless a `ready` Drive binding is already in the ledger). Both files must lie outside
  `archive.path` and `control.path` (`config-invalid` otherwise). A token the Google
  server refuses is a different error, `drive-token-invalid`, and only shows up later.
- **Control directory**: must already exist, be a real directory (not a symlink),
  owned by the user running the worker and not writable by group or others, else
  `control-unavailable` (exit 74). The exception is a control directory that is
  missing altogether: `init`, `run`, `verify` and `recover` check the lock first, and a
  missing `<control>/worker.lock` is `lock-not-held` (exit 78), not
  `control-unavailable`. (Under the documented `flock -n -F -E 75 <control>/worker.lock`
  form a missing control directory never gets that far: `flock` itself exits 66 first.) Only `inspect`, which skips the lock check, reports a
  missing control directory as `control-unavailable` (exit 74). Its ledger files are created 0600 and its
  directories 0700; `<control>/staging` is created 0700 and must be owned by the worker user and not
  writable by group or others.
  `<control>/worker.lock` must be a regular file (not a symlink); a missing or
  foreign lock is `lock-not-held` (exit 78).
- **Archive directory**: must already exist (the worker never creates the root), be
  a real directory whose path has no symlink in it (its real path equals
  `archive.path`), have the device and inode the ledger recorded at install time, not be writable by
  group or others, and be writable and searchable by the worker. Directories the
  worker creates below it are 0700 and must be owned by the worker user and not
  writable by group or others (`archive-unsafe-path`). Control and archive must
  both be on ext4 or xfs (`unsupported-filesystem`).

## Exit codes

stderr carries the reason code; the exit code follows it. The two tools use
different sets.

Worker (`scripts/eformsign-backup-worker.ts`):

| exit | meaning |
| --- | --- |
| 0 | ok. A `run` that ends `partial` or `blocked` is still 0; read the `run_*` event. The exceptions are a run that ends in `archive-conflict` or `ledger-inconsistent` (both 69): it has done and recorded all its other work, and its `run_*` and `run_reason` lines are still printed on stdout before the exit |
| 66 | not the worker's: `flock` exits 66 (`EX_NOINPUT`) when `<control>` does not exist, before the worker runs |
| 69 | state or archive: `not-initialized`, `recovery-required`, `ledger-duplicate-install`, `ledger-inconsistent`, `archive-identity-mismatch`, `archive-marker-invalid`, `archive-unavailable`, `archive-conflict`, `archive-not-mount-point`, `archive-unsafe-path`, `archive-space`; and the Drive reasons `drive-root-changed`, `drive-permission`, `drive-quota`, `drive-conflict`, `drive-unavailable`, and the transient `network-timeout`, `rate-limited` (see below) |
| 70 | internal: any other reason code or an unexpected error |
| 74 | control directory: `control-unavailable`, `control-space` |
| 75 | another worker holds the lock. Returned by `flock -E 75`, never by the worker itself |
| 78 | configuration: `config-invalid` (which includes any command line mistake), `token-file-invalid`, `export-base-url-invalid`, `lock-not-held`, `unsupported-filesystem`; and the Drive reasons `drive-not-configured`, `drive-token-invalid` |

The Drive reason codes end a command only when it is Drive-only (`drive-setup`) or when the
Drive part of `recover` cannot finish. Inside `run` and `verify` they never end the command: they
are reason codes of a `partial` run (see "What `run` does with two destinations"), and the exit
stays 0. `drive-setup` and `recover` can also end on the transient Drive reasons `network-timeout` and
`rate-limited`: they exit 69 ("unavailable, retry later", like `restore-drive`), and running the
command again is the answer. The meaning of each Drive reason code:

| reason code | meaning | exit when it ends a command |
| --- | --- | --- |
| `drive-not-configured` | no `drive` block, or no `ready` binding where one is needed (`drive-setup` not finished); also `recover --drive-root-folder-id` without a `drive` block | 78 |
| `drive-token-invalid` | Google's token endpoint refused the refresh token or the OAuth client (`invalid_grant`, `invalid_client` or `unauthorized_client`): a revoked or expired token, or a changed client; replace the secret files | 78 |
| `drive-root-changed` | the bound root folder is gone, trashed, renamed, moved or lacks its binding property; or `recover` found no root, or several | 69 |
| `drive-permission` | HTTP 401 after a forced token refresh, or 403 other than a rate-limit or quota reason | 69 |
| `drive-quota` | HTTP 403 `storageQuotaExceeded`: the Drive account is full | 69 |
| `drive-conflict` | an unexpected state at the Drive side: a file where the ledger expects another, two Drive objects at one path, or another 4xx answer | 69 |
| `drive-unavailable` | HTTP 5xx, or a status the worker cannot classify | 69 |
| `network-timeout` | no answer from Drive or the token endpoint in time, or the connection failed | 69 |
| `rate-limited` | HTTP 429, or 403 with a rate-limit reason; Drive asks to slow down | 69 |

Restore (`scripts/eformsign-backup-restore.ts`); it has no lock, so no 75 and no 74/78:

| exit | meaning |
| --- | --- |
| 0 | ok |
| 64 | usage (unknown, repeated or valueless flag, missing or doubled `--latest` / `--snapshot`, a relative `--archive`, a bad `--company`), or `restore-output-invalid` (bad `--out`), `invalid-path-segment` |
| 65 | data is wrong: `restore-conflict`, `artifact-integrity`, `pdf-shape`. Usually nothing is written, but see "Restore from the archive alone": a failure found while copying may leave partial output in `--out` |
| 66 | nothing to restore: `not-initialized` |
| 69 | archive: `archive-unavailable`, `archive-unsafe-path`, `archive-identity-mismatch`, `archive-marker-invalid` |
| 70 | internal: any other reason code or an unexpected error, including `artifact-too-large` (an archive file that has grown past the 128 MiB read limit; when it happens while copying, partial output may be left in `--out`) |

Restore from Drive (`scripts/eformsign-backup-restore-drive.ts`, see "`restore-drive`: the archive
from Drive alone"); no lock, no ledger:

| exit | meaning |
| --- | --- |
| 0 | every file verified and written |
| 64 | usage (unknown, repeated or valueless flag, a missing or relative `--config` / `--out`, a bad `--root-folder-id`; stderr `config-invalid`), or `restore-output-invalid` (`--out` not new or empty, or inside or around the archive or control path) |
| 65 | at least one file failed verification: stderr `artifact-integrity`, else `drive-conflict`, else `mirror-missing`; the files that did verify are written, the failed ones are listed in the report |
| 69 | Drive: `drive-root-changed` (no single root; see below), `drive-permission`, `drive-quota`, `drive-conflict`, `drive-unavailable`, `network-timeout`, `rate-limited` |
| 70 | internal: any other reason code or an unexpected error |
| 78 | configuration: `config-invalid` (the config file itself, or a configured `archive.path` or `control.path` that exists but cannot be resolved), `token-file-invalid`, `drive-not-configured`, `drive-token-invalid` |

## Never delete `worker.lock` while a run may be active

Do not delete, rename or replace `<control>/worker.lock` while any worker command may
be running. A deleted or replaced lock file lets a second worker lock a new file
while the first still holds the old one, and two workers would then write the same
ledger.

The worker defends itself, but only partly. Once per composite ledger operation,
immediately before its first destructive call (a journal append, the cut of a torn
journal tail, the first write of `init`, the rename that quarantines a ledger, the
write of a checkpoint), it re-checks that `/proc/locks` still lists this process
on the lock inode it verified at start and that `<control>/worker.lock` still
resolves to that same device and inode. If not, the active run stops with
`lock-not-held` (exit 78) before its next ledger write.

That check is not atomic with the write that follows it, so a small window remains:
deleting the lock is still unsafe. The guard narrows the damage; it does not make
deletion safe. A torn-tail repair that the check refused can leave a harmless
`ledger/tail-<n>.quarantine` copy; the next open reuses it.

## Crash recovery

A staged copy that no longer matches its own hash (flipped bytes, truncation)
is never published: `run` renames it to `<artifactIdentity>.bin.corrupt-<runId>`
in `<control>/staging`, downloads the artifact again when the snapshot still
offers it, and otherwise records `exact-bytes-unavailable`. Local staging damage
does not count towards `integrity-repeated`. The worker never deletes the
renamed file, so see "Staging files the worker leaves behind" below.

`run` always starts by finishing what a killed run left behind: an artifact in
`transferring` or `verifying` is re-checked against the archive (found with the
right hash: verified; damaged: renamed aside and `integrity_error`; missing:
queued again), and every unfinished run gets a late `run_finished` with
`crashed`. Nothing is deleted at any point; damaged files get a `.corrupt-<runId>`
suffix.

## Manifest file names

Each document revision is indexed by a manifest under
`eformsign/<company>/<document>/manifests/`. The worker writes every manifest as
`<metadataRevision>-<manifestSha256>.json`, where the suffix is the SHA-256 of the
file's own bytes: the same artifact claims always give the same file, and a
revision whose PDFs the source later offers with different bytes gets a second
file beside the first. Files named `<metadataRevision>.json` (written by earlier
builds) are still read and are never modified; both shapes can sit side by side.
A file whose name does not match its bytes, or one that lists an artifact whose identity does not derive from its own claims, is treated as damaged (by `run`, `verify --all`, `recover` and restore alike). A manifest is
written as soon as one artifact of the revision is verified, before its sibling
arrives; only a completion means the whole pair is there.

A manifest the ledger acknowledged or a completion names is *bound*. `run` finds a bound
manifest that has gone missing from the one manifest listing it already makes (the check
itself reads nothing) and publishes it again, byte for byte, when it can be rebuilt from the current
snapshot or from what the retained journals observed for that revision; if not, nothing is
written and the run ends in `archive-conflict` after its other work. The existence check
does not read present bound manifests (damage to one is found by `verify --all`), but
`run` still reads the relevant present manifests of documents outside the snapshot while
it backfills missing manifests.

Remediation for a damaged bound manifest (reported by `verify --all`, or by a `run`
that ends in `archive-conflict`): move the damaged file aside (rename it; do not delete
it, it is the evidence). The next `run` then finds it missing and publishes it again
byte for byte if it can rebuild it; if it cannot, put back an intact copy of the file
from a backup instead. Then run `verify --all` and expect exit 0.

Rollback: an older build does not know the versioned names. Once this build has
written to an archive, going back to older code alone leaves the restore script
unable to read its completions (`--latest` reports `not-initialized`),
`--allow-incomplete` silently leaves those documents out, and an older `recover`
does not re-hash artifacts listed only in versioned manifests. Roll back the code
only together with a plan for the archive, never on its own.

## Restore from the archive alone

    cd backend && NODE_PATH=. node -r ts-node/register/transpile-only \
      scripts/eformsign-backup-restore.ts --archive <abs> --company <id> \
      (--latest | --snapshot <id>) [--allow-incomplete] --out <abs>

Restore reads only the archive: not the control directory, not the ledger, not
the database. The completion with the highest sequence in its file name is the
latest one; `latest.json` and file times are ignored. Two completions that cannot
both be right (`restore-conflict`, exit 65), and a tampered or missing artifact or
manifest (`artifact-integrity`, exit 65) found by the up-front check stop the
restore before anything is written. That check covers every artifact the restore
will copy; a conflict or a bad manifest is found while planning, also before the
first write. An artifact that changes or disappears after the check, while it is
being copied, still fails the restore: an integrity failure ends with
`artifact-integrity` (exit 65), and an artifact replaced by a symlink with
`archive-unsafe-path` (exit 69); one that grows past the 128 MiB read limit
(`READ_MAX_BYTES`) between the check and the copy ends with `artifact-too-large`
(exit 70). Documents copied before the failure, if any, stay
in `--out`; nothing is rolled back. `--out` must be a new
or empty real directory outside the archive; running restore again into a
non-empty `--out` is refused with `restore-output-invalid` (exit 64). After a failed
copy, check the archive, then restore into a fresh empty `--out` and discard (or keep
aside) the partial one; do not use it as a restore. The
report `restore-report.json` says `unverified-archive` (or `incomplete-archive`
when restored from manifests with `--allow-incomplete`), lists the gaps recorded
in the completion and the completions that were set aside; it never says the
archive is complete. With `--allow-incomplete` and no usable completion, restore
picks no winner between manifests: if any one document has manifests that list
different artifact sets (for example an old and a new version of its audit trail),
the whole restore refuses with `restore-conflict` (exit 65). Restore a snapshot
that has a completion instead.

## When the ledger says `recovery-required`

`run` and `verify` refuse (exit 69) when the ledger is damaged, the control
marker does not match the ledger, or an archive marker exists with no
installation. Nothing repairs this on its own. To decide:

1. `inspect` shows the status and the reasons without changing anything.
2. Read `<archive>/.bjj-backup/installation.json`: its `installationId` is the
   identity of the archive you mean to keep. If the archive was replaced or
   restored from another disk, stop: this is not a recovery, it is a new install.
3. `recover --installation-id <that id>` refuses, changing nothing, unless all of
   these hold: the archive root is the directory the ledger recorded at install
   time (device and inode from the `installed` or an earlier `recovery_started`
   record, read from the checkpoint or from the first line of a journal), the
   archive marker names that id and this archive, and the control marker (if
   any) agrees. If the ledger holds records but none of them is such an
   install record, nothing proves which archive was installed and `recover` refuses with
   `archive-identity-mismatch` (exit 69); restore the control directory from a
   copy, or install again. The id on the archive marker is accepted as the proof
   only when the ledger directory is missing, empty, or holds no complete record
   (no checkpoint, and no journal with a newline-terminated line): that is what a
   crash inside `init` leaves.
   `recover` reads `ledger/` and every `ledger.quarantine-<uuid>` directory:
   a `ledger.quarantine-*` directory from another installation (a reused control
   directory) makes it refuse, so move that directory out of the control directory
   before retrying. The same goes for an operator who moved the archive to a new
   inode: move the `ledger.quarantine-*` directories out as well as `ledger/`. A
   directory that cannot be read, and a checkpoint or journal that cannot be read,
   also make it refuse with `control-unavailable`.
   A torn last journal line is repaired only after all of these checks pass, so
   a refused `recover` leaves `ledger/` byte-for-byte as it found it.
4. After the checks, `recover` moves the damaged ledger aside as
   `ledger.quarantine-<runId>`, starts a new one that records the highest
   sequence found in the archive (so a sequence is never reused) and the gaps
   the completions already knew about, and re-hashes every artifact named by
   every manifest found in the archive: the ones a completion names (the manifest
   itself is also checked against the hash the completion recorded) and the ones
   no completion names. Only artifacts that still hash correctly are recorded as
   recovered; the command reports the rest as `unverified`.
5. A control marker that exists but disagrees with the archive is never
   overwritten, and neither is one that cannot be parsed. In both cases move
   `<control>/installation.json` aside by hand once you have decided the archive
   is right; `recover` then writes it again from the archive marker.
6. Re-running `recover`. A `recover` that was interrupted (for example killed)
   leaves an `ok` ledger that starts with `recovery_started` and holds only
   some of the `recovered_verified` records. Run the same command again with the same
   `--installation-id`: it resumes, skips every entry already `recovered_verified`,
   re-hashes and appends only the rest, and appends nothing when everything is done.
   It resumes only while all of these hold: the ledger's origin is
   `recovery_started`; no `run_started` exists, meaning neither `run` nor `verify` has
   run since (both append `run_started`); the id you give is the ledger's
   installation id; and the archive root still has the device and inode the ledger
   recorded, with a marker naming that id. After a `run` or `verify`, recover can no
   longer resume and refuses with `ledger-inconsistent` (exit 69), as it does for any
   other `ok` ledger. A wrong installation id or a swapped archive gives
   `archive-identity-mismatch`, and a missing marker `archive-marker-invalid` (both
   exit 69).
7. With a `drive` block, `recover` continues after the steps above with the Drive part
   ("Recovery with Drive" below). It never creates anything on Drive, and the rebuilt local
   ledger stays whatever the Drive part ends with.

## Staging files the worker leaves behind

`<control>/staging` holds `<artifactIdentity>.bin` (kept after publishing, so a
damaged archive copy can be republished without a download) and, after damage,
`<artifactIdentity>.bin.corrupt-<runId>`. The worker never deletes anything. The
`.corrupt-` copies and any temporary file a killed run left are safe to remove by hand
while no worker is running, after you have looked at them. A plain `.bin` is not in that
class: it can be the only copy of an artifact (for example one that was staged but never
published, or one the ledger no longer knows after a ledger loss and `recover`, or one the
export no longer offers), and deleting it then loses the artifact. `orphanTemps` in the run
counts everything in the directory that is not a plain `<64 hex>.bin`, including the
`.corrupt-` copies, so it tells you when something is waiting for you.

With a Drive binding the staged `.bin` is also the source of the Drive upload, so it matters
which destination still needs it. A staged copy that is gone is restaged from the archive or from
Drive (whichever holds a verified copy) before the export is asked again, and a damaged archive
or Drive copy is replaced from the staged one. The worker still deletes nothing. A staged `.bin`
may be removed by hand only when that specific artifact (the file name is its
`artifactIdentity`) is verified on the local archive AND on the current Drive revision, and
no command checks that per file yet. `inspect` reports `stagingReleasable`, the number of such
artifacts (it appears once a Drive binding exists); it is only a count, names no file, and
never authorizes deleting any particular file, even when it equals `verified`: after a ledger
loss and `recover`, a staged-only artifact is not in the rebuilt ledger at all, so the counts
can add up while that `.bin` is the artifact's only copy. A `.bin` that the ledger (rebuilt or
not) does not account for must be kept. Staging cleanup is not supported by the tooling yet:
keep the `.bin` files.

# Google Drive destination (BJJ-456)

Drive is a second destination next to the local archive. The two are independent: a Drive
failure never fails the local side, and a lost archive does not stop the Drive upload. All of
this is optional and off unless the configuration has a `drive` block. The worker was developed
against a fake Drive on the loopback address only; what is not yet proven against the real Google
service is listed at the end ("Not yet proven against real Drive").

## What lands on Drive

One root folder holds a copy of the archive tree, path for path: every archive path
(`.bjj-backup/installation.json`, `eformsign/<company>/<document>/artifacts/<type>/<sha256>.pdf`,
the manifests, the completions and the run inventories) is a path below the root, every
`/`-separated prefix is a folder, and the last segment is the file name. The bytes are the
archive's bytes. The worker only ever creates and reads on Drive: it never deletes, trashes,
renames, moves or overwrites a file there. It trusts only Drive's own facts about a file (not
trashed, one parent, name, type, size, and the SHA-256 Drive computed, or the hash of the
downloaded bytes when Drive reports none); labels stored on a file prove nothing.

The root folder carries three identifiers as labels (`bjjInstallationId`, `bjjArchiveId`,
`bjjBindingId`; no secret) that `recover` and `restore-drive` use to find it again. In the ledger
the destination is `drive:<root folder id>` and its revision `drive-layout-v1:<binding id>`;
`drive-setup --rebind` creates a new binding and so a new revision; `recover` adopts the root's
existing binding id, so the revision stays the same.

## Preparing OAuth for a personal Gmail account

The worker authenticates as one Google account with an OAuth refresh token. The worker ships no
consent helper, so this part is manual and happens once. No value below goes into the repository
or a ticket.

1. In the Google Cloud console create (or choose) a project and enable the Google Drive API in it.
2. Configure the OAuth consent screen: user type External, and add only the scope
   `https://www.googleapis.com/auth/drive.file` (access to the files the app itself creates).
   Then publish the app to Production. While it stays in Testing, Google expires the refresh token
   after 7 days and the worker ends with `drive-token-invalid`; the scope is non-sensitive, so
   publishing does not need Google's verification review.
3. Create an OAuth client of type Desktop app. Its client id and client secret are the contents
   of `drive.clientFile`; the worker accepts only the flat JSON object
   `{"client_id": "<id>", "client_secret": "<secret>"}`, so copy the two values into a new file
   rather than using a downloaded file as it is.
4. With that client, run one OAuth authorization-code flow as the Gmail account that is to own
   the backup: scope `drive.file`, `access_type=offline`, redirect to a loopback address
   (`http://127.0.0.1:<port>`) on a machine you trust, then exchange the code at the token
   endpoint. Keep only the refresh token (one line of 20 to 512 characters from
   `A-Z a-z 0-9 _ - / .`) and discard the rest.
5. Write both files as the worker user with mode 0600 (for example under `umask 077`), outside
   the archive and control directories, and point `drive.clientFile` and
   `drive.refreshTokenFile` at them.

Keep the OAuth client for the life of the backup. The `drive.file` scope only shows an app the
files its own client created, so a different client sees none of the existing Drive tree: the
worker would no longer find the root (`drive-root-changed`), and `recover` and `restore-drive`
could not find it either. Replacing only the refresh token of the same client is fine: rewrite
`drive.refreshTokenFile`. A revoked or expired refresh token, or an OAuth client that Google no
longer accepts, is `drive-token-invalid`.

## Binding the Drive root: `drive-setup`

    cd backend && NODE_PATH=. flock -n -F -E 75 <control>/worker.lock \
      node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts \
      drive-setup --config <abs path to worker.json> [--rebind]

It needs an initialized installation with a healthy ledger (`init` first: `not-initialized`
and `recovery-required` otherwise, both exit 69), a readable archive marker (`archive-unavailable`,
exit 69) and a `drive` block with usable secret files (`drive-not-configured`,
`token-file-invalid`, `drive-token-invalid`: exit 78). On success it prints one line, for example
`{"event":"drive_bound","rootFolderId":"<id>","destinationRevision":"drive-layout-v1:<uuid>"}`.

What it does, in this order, and every step is durable and can be resumed:

1. Reads the id of the account's My Drive and the account's permission id, and takes a new
   file id for the root from Drive.
2. Appends `drive_bound` to the ledger with that id and a new binding id. The binding now exists
   with status `pending`.
3. Creates the root folder (named `drive.rootFolderName`, directly in My Drive) under exactly
   that id, carrying the three labels above. A lost answer or a retry is resolved by looking the
   id up and comparing, never by creating a second folder.
4. Publishes the archive marker as `.bjj-backup/installation.json` on Drive, byte for byte.
5. Appends `drive_ready`; the binding is now `ready`.

It is idempotent. Run again after a failure or a kill, it finishes the `pending` binding with
the same root id: no new id, no second root. Run on a `ready` binding whose root is intact and
whose marker is on Drive it changes nothing and prints the same line. **A `pending` binding is
not usable:** a `run` with a pending (or no) binding uploads nothing to Drive and reports
`drive-not-configured`; running `drive-setup` again completes it.

The root counts as intact while it is the same folder: not trashed, still named as bound,
still the only parent the binding recorded, still carrying its `bjjBindingId`. If someone
renames, moves or trashes it (or it can no longer be found), `run` stops its Drive work with
`drive-root-changed` and `drive-setup` ends with it (exit 69). If the cause is simply undone
(rename back, restore from the trash), the next command works again without any rebind.

`drive-setup --rebind` is for when the root is really gone. It always binds a new root, even if
the current one is intact, so do not use it for anything else. It leaves the old root and
everything in it untouched (nothing is deleted or reused) and starts a new revision with nothing
uploaded. The following `run` commands then upload everything again under the new root:
the artifacts the archive holds verified (from the staged copy, else from the archive after a
hash check; this includes artifacts `recover` adopted from the archive, whose length the
ledger does not hold: it is taken from the archive bytes once they match the recorded hash), then the manifests, completions and run inventories, from the archive or, for
records only the Drive outbox held, from the outbox bytes. The first run after a rebind can
therefore take as long as the whole archive needs to upload; the run is resumable, so a killed
run continues from the ledger. `inspect` counts only the current revision. Because the old and
the new root both carry the archive id and installation id, a later `recover` (or
`restore-drive`) sees two roots and needs the root named explicitly, unless the old root was
trashed (see the sections below).

## What `run` does with two destinations

With a `ready` binding each `run` does its normal local work and, as a second, independent
destination, the same for Drive. The Drive side uploads from the staged copies in
`<control>/staging`, never needs the archive to be up, and keeps its own ledger entry
for every artifact (`pending`, `transferring`, `verifying`, `verified`, and the failure states)
under the Drive revision. Interrupted Drive entries of an earlier run are settled first, by
asking Drive what exists under the reserved file id. Every file id is written to the ledger
before Drive sees it, so a killed run resumes with the same id instead of creating a duplicate. The `run_*` line
adds `driveVerified`, `driveBlocked`, `driveRetryWait` and `driveIntegrityError` to its
`counts`.

- **Drive failures make the run `partial`, never `failed` or `blocked`, and the exit stays 0.**
  They are reason codes of the run: `drive-token-invalid`, `drive-permission`, `drive-quota`
  and `drive-conflict` (the entry is `blocked`), `network-timeout`, `rate-limited` and
  `drive-unavailable` (the entry waits in `retry_wait`), `drive-root-changed`,
  `artifact-integrity` (a Drive copy that does not match its artifact: `integrity_error`,
  uploaded again under a new file id; after repeated failures `integrity-repeated`, which is not
  retried), and `token-file-invalid` (a Drive secret file cannot be used). They replace
  `drive-not-configured` in the list. A healthy run is `partial` with `coverage-unverified`, as
  before. A `blocked` or `retry_wait` Drive entry is tried again by every later run.
- **Waiting and stopping.** A transient failure waits `min(60 * 2^(n-1), 21600)` seconds
  before that artifact is tried again (n is the attempt number; a `Retry-After` from Drive is a
  lower bound). Three transient failures in a row stop the Drive work for the rest of the run.
  `drive-token-invalid`, `drive-permission` and `drive-quota` also stop it, because nothing
  else can succeed; the remaining artifacts are recorded as blocked with that reason.
  `drive-root-changed` is found once, before the first Drive call that has work to do, and
  stops the Drive work for the whole run before anything is uploaded. The local archive is
  untouched by all of this.
- **Archive down, Drive up.** The local side ends as `blocked` with `archive-unavailable`, but
  the Drive side goes on uploading from staging and publishes its records. The first run after
  the archive returns catches the archive up from the staged copies without a new export download.
- **Control down, nothing new.** When the control directory is unusable or below its reserve the
  run ends with `control-space` or `control-unavailable` (exit 74), as it always did. The worker
  checks the control directory's ledger reserve immediately before every Drive operation: below
  it, no Drive request is made and the run stops with `control-space`.
- **Order of records.** A manifest goes to Drive only when every artifact it names is verified on
  the current Drive revision. A completion goes only when every manifest it names is on Drive,
  byte for byte. So Drive never holds a record that names something Drive does not have, and
  a completion on Drive means everything it lists is on Drive.
- **Records the archive could not keep.** A manifest, completion or run inventory that the
  Drive phase must publish but the local archive did not publish in the same run (archive down,
  or refused) is first written to `<control>/drive-outbox/<sha256>.json` (directory 0700, file 0600,
  synced, never replaced) and recorded as pending in the ledger; the next runs publish it from
  those bytes, checking the hash. A missing or damaged outbox file leaves the record pending and
  the run reports `artifact-integrity`. Records the archive did publish are caught up from the
  archive's bytes. The worker never deletes an outbox file. Keep them: they are small, and a
  later `--rebind` re-publishes records from them when the archive does not hold the record. An
  outbox file whose record is still pending must never be removed; one whose record is on Drive
  may be removed by hand if you accept that limit.
- **A completion written while the archive was down exists only on Drive.** It lists the
  documents whose artifacts are all on Drive and a gap, with its reason, for each other document
  of the snapshot. It still names the local destination identity (it is built from the same bytes
  the archive would have written), and there is never more than one completion per snapshot
  sequence: with a healthy archive only the local completion exists, and a byte-identical copy
  of it goes to Drive. `restore-drive` followed by `restore --latest` gives exactly the documents
  such a completion lists.
- **The copies heal each other.** An artifact whose staged copy is gone is restaged from the
  archive or from Drive, whichever holds a verified copy, before the export is asked again.

## Checking Drive with `verify`

With a `ready` binding, `verify` also rechecks the Drive copies of the current revision, in
addition to the archive: with `--all` every Drive artifact is downloaded and hashed; without it,
those never checked or last verified more than 7 days ago are checked against Drive's own facts
(parent, name, type, size, checksum; a download only when Drive reports no checksum). It checks
artifacts only, not the Drive copies of manifests or completions. A Drive copy found missing or
different becomes an `integrity_error` of its Drive entry, and the next `run` uploads it again
under a new file id; nothing is deleted on Drive. The `verify_finished` counts (`checked`,
`integrityErrors`) include the Drive entries. If Drive cannot answer (unreachable, token refused,
root changed, unusable secret file) nothing is recorded as damaged and the exact reason code
(for example `drive-root-changed`, `network-timeout`, `drive-token-invalid`) is on the verify
run's `run_finished` record in the ledger; the exit stays 0. The Drive pass also runs when the
archive is unavailable.

## Recovery with Drive

**Ledger lost, Drive and archive present.** Run `recover` as described above. With a `drive`
block it then adopts the Drive root that already holds the archive. It creates, uploads, renames
and trashes nothing on Drive. Everything it reads is validated before it is written to the
ledger: the marker must equal the archive marker byte for byte, the manifests, completions and run
inventories must pass their parsers, and an artifact is recovered only after Drive's checksum
(or the downloaded bytes) proves it. A completion that only Drive holds still counts as the
sequence evidence, so its sequence number is never reused. The root is chosen in this order:

1. `recover --installation-id <id> --drive-root-folder-id <root id>`: that folder, which must be
   an untrashed folder of this installation holding the archive marker.
2. Else the root of the `pending` binding already in the ledger (an interrupted `recover`).
3. Else discovery: the untrashed folders whose installation label equals the installation id and
   that hold a marker equal to the archive marker. Exactly one is adopted. If more than one
   qualifies (typically after a rebind, since the old root is left in place), `recover` prints
   `{"event":"recover_drive_root_ambiguous","reasonCode":"drive-root-changed","candidates":[{"rootFolderId":"<id>","bindingId":"<uuid>"}]}`
   (ids only), exits 69, and you run it again with `--drive-root-folder-id <id>` of the root
   you want, or trash the old root first. A root whose marker differs from the archive's is never
   adopted: if every candidate holds a different marker the result is `archive-conflict`
   (exit 69), and with no candidate at all `drive-root-changed`.

The local part is finished and kept whatever the Drive part ends with. A Drive that cannot be
used now (unreachable, token refused, secret file unusable) ends `recover` with that reason
and a later `recover` with the same arguments finishes the Drive part without creating
anything twice. If the config has a `drive` block but there is no root on Drive at all (it was
never set up), `recover` finishes locally and then exits 69 `drive-root-changed`: run
`drive-setup`. Two Drive objects at one path of the layout are `drive-conflict` (exit 69) and
nothing from Drive is written. A `recover` that finds a `ready` binding already in the ledger
does nothing more for Drive, and refuses a different `--drive-root-folder-id` with
`drive-root-changed`: use `drive-setup --rebind` to bind another root.

After `recover` the next `run` resumes with no duplicate creates: the adopted folders, files
and records are in the ledger.

**Local archive lost too.** Rebuild the archive from Drive first, then continue as above:

1. `restore-drive` (next section) into a new empty directory outside the configured archive and
   control paths. It refuses any `--out` inside or around them.
2. Move `.restore-drive-tmp/` and `restore-drive-report.json` out of that directory (the
   archive must hold only its own files), put the directory at the configured `archive.path`
   (the same `archive.archiveId`; with the default `requireMountPoint: true` it must be a
   mount point) with the ownership and mode rules above, and have a control directory with
   its `worker.lock` and no ledger (new, or the old one with `ledger/` and every
   `ledger.quarantine-*` moved out, since the restored archive is a new inode).
3. `recover --installation-id <id>` with `<id>` from `<archive>/.bjj-backup/installation.json`,
   under the lock, as above. It rebuilds the ledger from the archive and adopts the Drive
   root.

To only get the documents back, you do not need steps 2 and 3: run the normal restore on the
`restore-drive` output.

## `restore-drive`: the archive from Drive alone

    cd backend && NODE_PATH=. node -r ts-node/register/transpile-only \
      scripts/eformsign-backup-restore-drive.ts --config <abs path to worker.json> \
      --out <abs new or empty dir> [--root-folder-id <id>]

It copies the Drive tree into `--out`, path for path, so the result has the layout of the
archive and the unchanged `scripts/eformsign-backup-restore.ts` works on it. It needs only the
`drive` block and its secret files (the rest of the config is validated; `archive.archiveId`
selects the root, `archive.path` and `control.path` only keep `--out` away from them, and
`enabled` is ignored). It takes no lock and reads no ledger, archive or control directory, and
those need not exist. It only reads on Drive (GET requests).

- `--out`: an absolute normal path of a new or an empty real directory. It must not be, contain
  or lie in the configured `archive.path` or `control.path` (also through symlinks), else
  `restore-output-invalid` (exit 64) before any request. An `archive.path` or `control.path`
  that exists but cannot be resolved (a dangling symlink, a symlink loop, an I/O error) is
  `config-invalid` (exit 78), also before any request; a path that is simply absent is fine.
  An existing empty `--out` is accepted as it is, with no check of its owner or mode: create
  `--out` (or its parent) as the worker user with mode 0700, as for the archive, before the
  restore. `--root-folder-id` must be a Drive file id.
- The root is the untrashed folder labelled with `archive.archiveId`. None, or more than one
  (for example after a rebind), is `drive-root-changed` (exit 69): stdout then carries
  `{"event":"restore_drive_root_ambiguous","reasonCode":"drive-root-changed","candidates":[...ids]}`;
  rerun with `--root-folder-id <id>` to choose one (it must be an untrashed folder of this
  archive id).
- The whole tree is listed first. Each file is then received, verified against what its own
  path claims, and only then written. An artifact must have the SHA-256 in its name and be a
  PDF of the expected shape; a manifest, completion, run inventory and the marker must pass
  their parsers (a completion's name must match its content, the marker must name this archive
  id). A manifest must agree with its verified artifacts on length and a completion with its
  manifests on digest. Anything else (an unsafe name, an unknown path, a Google-native
  document) fails.
- A file that fails is not written. A verified file is linked into place without ever
  overwriting an existing one. If two or more Drive files map to the same path (Drive allows
  equal names in one folder), that path is reported once, as `drive-conflict`, whatever order
  they come in and whichever copy verifies, and it is not counted in `verified`, so the run
  ends 65; a copy that verified and was already linked stays in place. A path with one Drive
  file is counted once. Files are 0600, directories 0700.
- At the end `--out/restore-drive-report.json` holds `schemaVersion`, `rootFolderId`,
  `archiveId`, `verified`, `failed` and `failures` (`relativeKey` and a reason:
  `artifact-integrity`, `mirror-missing`, `drive-conflict`). stdout is one line:
  `restore_drive_verified` (exit 0) or `restore_drive_failed` (exit 65), each with
  `rootFolderId` and `counts` (`verified`, `failed`). The exit codes are in the table above.
  A command that ends before that point (69, 78, 70) leaves no report and may leave
  partial output: start again in a new empty directory.
- `--out/.restore-drive-tmp/` stays: the worker deletes nothing, files that failed or collided
  are truncated to zero bytes, and a verified file is a hard link of its mirrored file. You may
  delete `.restore-drive-tmp/` after the run; the mirrored files are not affected.

**If a file failed (exit 65).** The unchanged restore is fail-fast: a missing or corrupt artifact
named by the completion it selects stops it. `restore-drive` therefore does not give you a
partial restore of the latest snapshot. `restore --latest` on the output fails with
`artifact-integrity` when the latest completion names a failed file. Read `failures` in the
report and restore a `--snapshot` whose completion names none of the failed files (an earlier
one, which restores normally), as under "Restore from the archive alone":

    cd backend && NODE_PATH=. node -r ts-node/register/transpile-only \
      scripts/eformsign-backup-restore.ts --archive <the restore-drive --out dir> --company <id> \
      (--latest | --snapshot <id>) --out <another new dir>

## Not yet proven against real Drive

Everything above was built and tested against a fake Drive and fake OAuth server on the loopback
address. These points stay unverified until the first real run (BJJ-457): that publishing the
consent screen to Production is what keeps the refresh token alive (Testing: 7 days) and that
`drive.file` is enough for every call the worker makes; that real Drive reports a SHA-256
checksum for every uploaded file (the worker downloads and hashes when it does not); how real
Drive answers a create with a pre-generated id, including a repeated create (the worker
treats a 409 by looking the id up and comparing); and the upload of a zero-byte file.
