import type { Observable } from "rxjs";

import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import type { EntityChangeTransport } from "./entity-change-transport";
import { InProcessEntityChangeTransport } from "./in-process-entity-change-transport";
import { ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

/** Valkey when `VALKEY_URL` is set (any number of backend instances), otherwise in-process. */
export function createEntityChangeTransport(
    bus: { events$: Observable<EntityChangedEvent> },
    env: NodeJS.ProcessEnv = process.env,
): EntityChangeTransport & { onModuleDestroy(): void } {
    const url = env["VALKEY_URL"]?.trim();
    return url ? new ValkeyEntityChangeTransport(bus, { url }) : new InProcessEntityChangeTransport(bus);
}
