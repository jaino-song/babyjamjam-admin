import { Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

const CHANNEL = "eformsign:backup:ready-wake";
const MAX_STREAMS = 16;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const COMMAND_TIMEOUT_MS = 5_000;
const SUBSCRIBER_PING_MS = 15_000;

type Listener = (frame: "ready" | "wake" | "close") => void;

export class EformsignBackupWakeTransport implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(EformsignBackupWakeTransport.name);
    private readonly listeners = new Set<Listener>();
    private publisher?: Redis;
    private subscriber?: Redis;
    private subscribed = false;
    private stopped = false;
    private pending = false;
    private publishing = false;
    private retry?: NodeJS.Timeout;
    private retryMs = RETRY_MIN_MS;
    private subscriptionRetry?: NodeJS.Timeout;
    private ping?: NodeJS.Timeout;

    constructor(private readonly url: string | undefined) {}

    onModuleInit(): void {
        if (!this.url) return;
        const options = {
            enableOfflineQueue: false,
            autoResubscribe: false,
            autoResendUnfulfilledCommands: false,
            connectTimeout: COMMAND_TIMEOUT_MS,
            commandTimeout: COMMAND_TIMEOUT_MS,
            keepAlive: SUBSCRIBER_PING_MS,
            retryStrategy: (attempt: number) => Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (attempt - 1)),
        };
        const publisher = this.publisher = new Redis(this.url, options);
        const subscriber = this.subscriber = new Redis(this.url, options);
        // ioredis errors may contain the connection URL.
        publisher.on("error", () => undefined);
        subscriber.on("error", () => undefined);
        publisher.on("ready", () => this.flush());
        subscriber.on("message", (channel: string, message: string) => {
            if (this.subscribed && channel === CHANNEL && message === "") this.broadcast("wake");
        });
        let generation = 0;
        let subscriptionAttempts = 0;
        subscriber.on("close", () => {
            generation++;
            this.subscribed = false;
            clearTimeout(this.subscriptionRetry);
        });
        subscriber.on("ready", () => {
            const current = generation;
            void subscriber.subscribe(CHANNEL).then(() => {
                if (this.stopped || current !== generation || subscriber.status !== "ready") return;
                subscriptionAttempts = 0;
                this.subscribed = true;
                this.broadcast("ready");
            }).catch(() => {
                if (!this.stopped && current === generation && subscriber.status === "ready") {
                    this.logger.warn("Archive wake subscription unavailable");
                    const delay = options.retryStrategy(++subscriptionAttempts);
                    this.subscriptionRetry = setTimeout(() => subscriber.disconnect(true), delay);
                    this.subscriptionRetry.unref();
                }
            });
        });
        this.ping = setInterval(() => {
            if (!this.subscribed) return;
            const current = generation;
            void subscriber.ping().catch(() => {
                if (!this.stopped && current === generation) subscriber.disconnect(true);
            });
        }, SUBSCRIBER_PING_MS);
        this.ping.unref();
    }

    listen(listener: Listener): { ready: boolean; unsubscribe(): void } | undefined {
        if (this.stopped || this.listeners.size >= MAX_STREAMS) return undefined;
        this.listeners.add(listener);
        return { ready: !this.url || this.subscribed, unsubscribe: () => { this.listeners.delete(listener); } };
    }

    notify(): void {
        if (this.stopped) return;
        if (!this.url) {
            this.broadcast("wake");
            return;
        }
        this.pending = true;
        this.flush();
    }

    private broadcast(frame: Parameters<Listener>[0]): void {
        for (const listener of this.listeners) listener(frame);
    }

    private flush(): void {
        const publisher = this.publisher;
        if (this.stopped || !this.pending || this.publishing || this.retry || publisher?.status !== "ready") return;
        this.pending = false;
        this.publishing = true;
        void publisher.publish(CHANNEL, "").then(() => {
            this.retryMs = RETRY_MIN_MS;
        }).catch(() => {
            if (this.stopped) return;
            this.pending = true;
            this.logger.warn("Archive wake publication unavailable");
            if (publisher.status === "ready") publisher.disconnect(true);
            this.retry = setTimeout(() => {
                this.retry = undefined;
                this.flush();
            }, this.retryMs);
            this.retry.unref();
            this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
        }).finally(() => {
            this.publishing = false;
            this.flush();
        });
    }

    onModuleDestroy(): void {
        this.stopped = true;
        clearTimeout(this.retry);
        clearTimeout(this.subscriptionRetry);
        clearInterval(this.ping);
        this.publisher?.disconnect();
        this.subscriber?.disconnect();
        this.broadcast("close");
        this.listeners.clear();
    }
}
