import type { Observable } from "rxjs";

import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { deriveRealtimeCursorKey } from "./entity-change-cursor-codec";
import type { EntityChangeTransport } from "./entity-change-transport";
import { InProcessEntityChangeTransport } from "./in-process-entity-change-transport";
import { ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

/**
 * Valkey when `VALKEY_URL` is set (any number of backend instances), otherwise in-process.
 * Valkey mode derives the cursor key from the JWT secret every instance already shares, so a
 * cursor issued by one instance resumes on another; the secret itself is never logged or stored.
 */
export function createEntityChangeTransport(
    bus: { events$: Observable<EntityChangedEvent> },
    env: NodeJS.ProcessEnv = process.env,
    getSecret: () => string = getJwtSecret,
): EntityChangeTransport & { onModuleDestroy(): void } {
    const url = env["VALKEY_URL"]?.trim();
    return url
        ? new ValkeyEntityChangeTransport(bus, { url, cursorKey: deriveRealtimeCursorKey(getSecret()) })
        : new InProcessEntityChangeTransport(bus);
}
