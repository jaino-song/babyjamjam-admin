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
| `verify [--all]` | re-hashes verified artifacts (default: older than 7 days); damaged ones are renamed aside and recorded as `integrity_error` |
| `recover --installation-id <id>` | rebuilds a damaged ledger from the archive; see below |
| `inspect` | read-only report of the ledger; needs no lock |

With `"enabled": false` the commands `run`, `verify` and `recover` print
`{"event":"disabled"}` and do nothing (no lock, no ledger, no network).

stdout is one JSON object per line with keys from `event`, `runId`,
`reasonCode`, `counts`. stderr is a reason code and nothing else, so no token, path
or provider message reaches a log. Exit codes: 0 ok, 69 state or archive
(`not-initialized`, `recovery-required`, `archive-*`, `ledger-*`), 70 internal,
74 control directory (`control-unavailable`, `control-space`), 75 lock held
elsewhere (from `flock`), 78 configuration (`config-invalid`,
`token-file-invalid`, `lock-not-held`, `unsupported-filesystem`).

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

## Restore from the archive alone

    cd backend && NODE_PATH=. node -r ts-node/register/transpile-only \
      scripts/eformsign-backup-restore.ts --archive <abs> --company <id> \
      (--latest | --snapshot <id>) [--allow-incomplete] --out <abs>

Restore reads only the archive: not the control directory, not the ledger, not
the database. The completion with the highest sequence in its file name is the
latest one; `latest.json` and file times are ignored. Two completions that cannot
both be right (`restore-conflict`, exit 65), a tampered or missing artifact or
manifest (`artifact-integrity`, exit 65) stop the restore before anything is
written. `--out` must be a new or empty real directory outside the archive. The
report `restore-report.json` says `unverified-archive` (or `incomplete-archive`
when restored from manifests with `--allow-incomplete`), lists the gaps recorded
in the completion and the completions that were set aside; it never says the
archive is complete.

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
   any) agrees. If the ledger directory holds files but none of them yields that
   record, nothing proves which archive was installed and `recover` refuses with
   `archive-identity-mismatch` (exit 69); restore the control directory from a
   copy, or install again. Only when the ledger directory is empty (a crash
   inside `init`, before the first record) is the id on the archive marker
   accepted as the proof.
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

## Staging files the worker leaves behind

`<control>/staging` holds `<artifactIdentity>.bin` (kept after publishing, so a
damaged archive copy can be republished without a download) and, after damage,
`<artifactIdentity>.bin.corrupt-<runId>`. The worker never deletes anything. Both
kinds of leftover (and any temporary file a killed run left) are safe to remove by
hand while no worker is running, after you have looked at them; a `.bin` the
ledger still needs is simply downloaded again. `orphanTemps` in the run counts
everything in the directory that is not a plain `<64 hex>.bin`, including the
`.corrupt-` copies, so it tells you when something is waiting for you.
