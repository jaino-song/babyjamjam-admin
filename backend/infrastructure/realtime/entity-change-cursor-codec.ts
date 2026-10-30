import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { parseCursor } from "./entity-change-cursor";

/**
 * The cursor a client sees is not the stream id. A raw Valkey id is a millisecond timestamp plus a
 * sequence shared by every branch, so a connection that watched its own ids move would learn when
 * and how often other branches write. The id on the wire is therefore an AES-256-GCM token over a
 * compact binary form of the internal cursor, with a fresh random IV per token: the same cursor
 * never produces the same string twice, and nothing about it can be read, compared or forged.
 *
 * Layout: base64url( iv(12) ‖ ciphertext ‖ tag(16) ). Valkey cursor payload = 1 + 8 + 8 bytes
 * → 45 bytes → 60 chars; ring payload = 1 + 6 + 8 bytes → 43 bytes → 58 chars. Both fit the
 * contract's 64-char cursor limit and its `[0-9A-Za-z:._-]` charset.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const STREAM_TAG = 1;
const RING_TAG = 2;
const STREAM_PAYLOAD = 1 + 8 + 8;
const RING_PAYLOAD = 1 + 6 + 8;
const AAD = Buffer.from("realtime-cursor-v1");
const TOKEN_CHARSET = /^[A-Za-z0-9_-]+$/;
const RING_EPOCH = /^[0-9a-f]{12}$/;
const U64_MAX = (1n << 64n) - 1n;

export class CursorCodec {
    constructor(private readonly key: Buffer) {
        if (key.length !== KEY_BYTES) throw new Error(`realtime cursor key must be ${KEY_BYTES} bytes`);
    }

    /** Internal cursor → opaque token. Throws for something no transport of ours could have issued. */
    encode(cursor: string): string {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        cipher.setAAD(AAD);
        const body = Buffer.concat([cipher.update(serialize(cursor)), cipher.final()]);
        return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
    }

    /** Opaque token → internal cursor, or `null` for anything that is not an untampered token of this key. */
    decode(token: string): string | null {
        if (!TOKEN_CHARSET.test(token)) return null;
        const raw = Buffer.from(token, "base64url");
        const payloadLength = raw.length - IV_BYTES - TAG_BYTES;
        if (payloadLength !== STREAM_PAYLOAD && payloadLength !== RING_PAYLOAD) return null;
        try {
            const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, IV_BYTES));
            decipher.setAAD(AAD);
            decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
            const payload = Buffer.concat([
                decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
                decipher.final(),
            ]);
            return deserialize(payload);
        } catch {
            return null;
        }
    }
}

/** Same key on every instance, so a cursor issued by one can be resumed on another. */
export function deriveRealtimeCursorKey(secret: string): Buffer {
    return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "realtime-cursor-v1", KEY_BYTES));
}

/** Single-process key: tokens do not survive a restart, which matches ring cursors not surviving one. */
export function randomRealtimeCursorKey(): Buffer {
    return randomBytes(KEY_BYTES);
}

function u64(value: bigint): Buffer {
    if (value > U64_MAX) throw new Error("cursor component out of range");
    const out = Buffer.alloc(8);
    out.writeBigUInt64BE(value);
    return out;
}

function serialize(cursor: string): Buffer {
    const parsed = parseCursor(cursor);
    if (parsed?.kind === "stream") return Buffer.concat([Buffer.from([STREAM_TAG]), u64(parsed.ms), u64(parsed.seq)]);
    if (parsed?.kind === "ring" && RING_EPOCH.test(parsed.epoch)) {
        return Buffer.concat([Buffer.from([RING_TAG]), Buffer.from(parsed.epoch, "hex"), u64(parsed.seq)]);
    }
    throw new Error("not an encodable realtime cursor");
}

function deserialize(payload: Buffer): string | null {
    if (payload[0] === STREAM_TAG && payload.length === STREAM_PAYLOAD) {
        return `${payload.readBigUInt64BE(1)}-${payload.readBigUInt64BE(9)}`;
    }
    if (payload[0] === RING_TAG && payload.length === RING_PAYLOAD) {
        return `${payload.subarray(1, 7).toString("hex")}:${payload.readBigUInt64BE(7)}`;
    }
    return null;
}
