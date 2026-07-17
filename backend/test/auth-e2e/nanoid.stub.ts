import { randomUUID } from "node:crypto";

export const nanoid = (): string => randomUUID();
