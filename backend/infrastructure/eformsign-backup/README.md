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

## Running it

Every command except `inspect` must run while the process holds
`<control>/worker.lock`. Use `flock -F` so the lock belongs to the node process
itself, which the worker verifies against `/proc/locks`:

    cd backend && NODE_PATH=. flock -n -F -E 75 <control>/worker.lock \
      node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts \
      run --config <abs path to worker.json>

`flock` exits 75 when another worker holds the lock; treat that as "skipped,
overlapping run", not as a failure.

| command | what it does |
| --- | --- |
| `init` | first install only: archive marker, control marker, first ledger record |
| `run [--scheduled-for <ISO+offset>]` | finishes interrupted work, then one snapshot: download, publish, verify, manifests, completion |
| `verify [--all]` | re-hashes verified artifacts (default: older than 7 days); damaged ones are renamed aside and recorded as `integrity_error`. With `--all` it also reads every bound manifest (acknowledged by the ledger or named by a completion) and exits 69 `archive-conflict` if one is missing, is no valid manifest of its document, or has another digest than the ledger or a completion binds; it never writes anything |
| `recover --installation-id <id>` | rebuilds a damaged ledger from the archive; see below |
| `inspect` | read-only report of the ledger; needs no lock |

With `"enabled": false` the commands `run`, `verify` and `recover` print
`{"event":"disabled"}` and do nothing (no lock, no ledger, no network).

stdout is one JSON object per line with keys from `event`, `runId`,
`reasonCode`, `counts`. stderr is a reason code and nothing else, so no token, path
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
Reason codes in the run record say why.

## worker.json

One JSON file, passed as `--config <abs path>`, read once at start. It is strict:
an unknown field (top level or inside `control` / `archive`), a wrong type or a
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
- **Control directory**: must already exist, be a real directory (not a symlink),
  owned by the user running the worker and not writable by group or others, else
  `control-unavailable` (exit 74). The exception is a control directory that is
  missing altogether: `init`, `run`, `verify` and `recover` check the lock first, and a
  missing `<control>/worker.lock` is `lock-not-held` (exit 78), not
  `control-unavailable`. Only `inspect`, which skips the lock check, reports a
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
| 0 | ok. A `run` that ends `partial` or `blocked` is still 0; read the `run_*` event |
| 69 | state or archive: `not-initialized`, `recovery-required`, `ledger-duplicate-install`, `ledger-inconsistent`, `archive-identity-mismatch`, `archive-marker-invalid`, `archive-unavailable`, `archive-conflict`, `archive-not-mount-point`, `archive-unsafe-path`, `archive-space` |
| 70 | internal: any other reason code or an unexpected error |
| 74 | control directory: `control-unavailable`, `control-space` |
| 75 | another worker holds the lock. Returned by `flock -E 75`, never by the worker itself |
| 78 | configuration: `config-invalid` (which includes any command line mistake), `token-file-invalid`, `export-base-url-invalid`, `lock-not-held`, `unsupported-filesystem` |

Restore (`scripts/eformsign-backup-restore.ts`); it has no lock, so no 75 and no 74/78:

| exit | meaning |
| --- | --- |
| 0 | ok |
| 64 | usage (unknown, repeated or valueless flag, missing or doubled `--latest` / `--snapshot`, a relative `--archive`, a bad `--company`), or `restore-output-invalid` (bad `--out`), `invalid-path-segment` |
| 65 | data is wrong: `restore-conflict`, `artifact-integrity`, `pdf-shape`. Usually nothing is written, but see "Restore from the archive alone": a failure found while copying may leave partial output in `--out` |
| 66 | nothing to restore: `not-initialized` |
| 69 | archive: `archive-unavailable`, `archive-unsafe-path`, `archive-identity-mismatch`, `archive-marker-invalid` |
| 70 | internal: any other reason code or an unexpected error, including `artifact-too-large` (an archive file that has grown past the 128 MiB read limit; when it happens while copying, partial output may be left in `--out`) |

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
A file whose name does not match its bytes is treated as damaged. A manifest is
written as soon as one artifact of the revision is verified, before its sibling
arrives; only a completion means the whole pair is there.

A manifest the ledger acknowledged or a completion names is *bound*. `run` finds a bound
manifest that has gone missing from the one manifest listing it already makes (no extra
reads) and publishes it again, byte for byte, when it can be rebuilt from the current
snapshot or from what the retained journals observed for that revision; if not, nothing is
written and the run ends in `archive-conflict` after its other work. `run` does not read
present bound manifests: damage to one is found by `verify --all`.

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

## Staging files the worker leaves behind

`<control>/staging` holds `<artifactIdentity>.bin` (kept after publishing, so a
damaged archive copy can be republished without a download) and, after damage,
`<artifactIdentity>.bin.corrupt-<runId>`. The worker never deletes anything. Both
kinds of leftover (and any temporary file a killed run left) are safe to remove by
hand while no worker is running, after you have looked at them; a `.bin` the
ledger still needs is simply downloaded again. `orphanTemps` in the run counts
everything in the directory that is not a plain `<64 hex>.bin`, including the
`.corrupt-` copies, so it tells you when something is waiting for you.
