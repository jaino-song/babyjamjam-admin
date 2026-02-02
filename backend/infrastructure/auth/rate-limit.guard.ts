import {
    Injectable,
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';

interface RateLimitEntry {
    attempts: number;
    firstAttemptTime: number;
}

/**
 * Rate limit guard for authentication endpoints
 * Limits to 5 attempts per 15 minutes per IP+email combination
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
    // In-memory store for rate limiting (consider Redis for production multi-server setup)
    private readonly attempts = new Map<string, RateLimitEntry>();
    private readonly maxAttempts = 5;
    private readonly windowMs = 15 * 60 * 1000; // 15 minutes
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Clean up expired entries every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const ip = this.getClientIp(request);
        const email = this.getEmailFromRequest(request);

        // Create a key combining IP and email (if available)
        const key = email ? `${ip}:${email.toLowerCase()}` : ip;

        const now = Date.now();
        const entry = this.attempts.get(key);

        if (entry) {
            // Check if window has expired
            if (now - entry.firstAttemptTime >= this.windowMs) {
                // Window expired, reset
                this.attempts.set(key, { attempts: 1, firstAttemptTime: now });
                return true;
            }

            // Check if max attempts exceeded
            if (entry.attempts >= this.maxAttempts) {
                const remainingTime = Math.ceil(
                    (entry.firstAttemptTime + this.windowMs - now) / 1000 / 60
                );
                throw new HttpException(
                    {
                        statusCode: HttpStatus.TOO_MANY_REQUESTS,
                        message: `요청 횟수가 초과되었습니다. ${remainingTime}분 후에 다시 시도해주세요.`,
                        error: 'Too Many Requests',
                        retryAfter: remainingTime * 60,
                    },
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }

            // Increment attempts
            entry.attempts++;
        } else {
            // First attempt
            this.attempts.set(key, { attempts: 1, firstAttemptTime: now });
        }

        return true;
    }

    /**
     * Reset the rate limit for a successful authentication
     * Call this after a successful login to reset the counter
     */
    resetForKey(ip: string, email?: string): void {
        const key = email ? `${ip}:${email.toLowerCase()}` : ip;
        this.attempts.delete(key);
    }

    /**
     * Get client IP address from request
     * Handles proxied requests (X-Forwarded-For)
     */
    private getClientIp(request: Request): string {
        const forwardedFor = request.headers['x-forwarded-for'];
        if (forwardedFor) {
            const ips = Array.isArray(forwardedFor)
                ? forwardedFor[0]
                : forwardedFor.split(',')[0];
            return ips?.trim() || 'unknown';
        }
        return request.ip || request.socket?.remoteAddress || 'unknown';
    }

    /**
     * Extract email from request body
     */
    private getEmailFromRequest(request: Request): string | undefined {
        const body = request.body as { email?: string } | undefined;
        return body?.email;
    }

    /**
     * Clean up expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.attempts.entries()) {
            if (now - entry.firstAttemptTime >= this.windowMs) {
                this.attempts.delete(key);
            }
        }
    }

    /**
     * Clean up on destroy (for testing)
     */
    onModuleDestroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}
