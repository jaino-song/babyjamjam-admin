import os from "node:os";
import path from "node:path";

const PHASE3_AUTH_STORAGE_STATE_FILE = "babyjamjam-mobile-phase3-auth.json";

export const phase3AuthStorageStatePath = process.env.PHASE3_AUTH_STORAGE_STATE
  ?? path.join(os.tmpdir(), PHASE3_AUTH_STORAGE_STATE_FILE);
