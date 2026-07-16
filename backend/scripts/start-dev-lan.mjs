#!/usr/bin/env node
/**
 * Start the backend in watch mode with MOBILE_SERVICE_RECORD_BASE_URL resolved
 * from the machine's current LAN IPv4 at launch, so service-record links open
 * on a phone in the same network even when DHCP hands out a new address.
 *
 * An explicitly exported MOBILE_SERVICE_RECORD_BASE_URL always wins.
 * Pass --print to only show the resolved URL without starting the server.
 */
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";

const MOBILE_PORT = process.env.MOBILE_DEV_PORT ?? "3000";

function resolveLanIPv4() {
    const candidates = [];
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
        for (const addr of addrs ?? []) {
            if (addr.family !== "IPv4" || addr.internal) continue;
            candidates.push({ name, address: addr.address });
        }
    }
    // Prefer typical Wi-Fi/Ethernet interfaces over VPN/virtual ones.
    const preferred = candidates.find((c) => /^(en|eth|wl)/.test(c.name)) ?? candidates[0];
    return preferred ?? null;
}

let baseUrl = process.env.MOBILE_SERVICE_RECORD_BASE_URL;
if (baseUrl) {
    console.log(`[start-dev-lan] MOBILE_SERVICE_RECORD_BASE_URL already set: ${baseUrl}`);
} else {
    const lan = resolveLanIPv4();
    if (!lan) {
        console.error("[start-dev-lan] No LAN IPv4 found — falling back to http://localhost:%s (phone access won't work)", MOBILE_PORT);
        baseUrl = `http://localhost:${MOBILE_PORT}`;
    } else {
        baseUrl = `http://${lan.address}:${MOBILE_PORT}`;
        console.log(`[start-dev-lan] Resolved LAN IP ${lan.address} (${lan.name}) → MOBILE_SERVICE_RECORD_BASE_URL=${baseUrl}`);
    }
}

if (process.argv.includes("--print")) {
    console.log(baseUrl);
    process.exit(0);
}

const child = spawn("pnpm", ["exec", "nest", "start", "--watch"], {
    stdio: "inherit",
    env: { ...process.env, MOBILE_SERVICE_RECORD_BASE_URL: baseUrl },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
