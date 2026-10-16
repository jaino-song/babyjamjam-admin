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
