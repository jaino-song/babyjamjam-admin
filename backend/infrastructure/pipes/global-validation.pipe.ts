import { ArgumentMetadata, Injectable, ValidationPipe } from "@nestjs/common";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

/**
 * Application-wide validation pipe.
 *
 * Strict by default: constructed in main.ts with forbidNonWhitelisted so a
 * request body carrying fields no DTO declares is rejected (400) instead of
 * silently stripped — mass-assignment / client-server contract-drift hygiene.
 *
 * EXEMPT: inbound third-party webhook payloads whose shape we do not control.
 * NestJS applies a global pipe and any controller/route-level @UsePipes
 * ADDITIVELY (global first), so a permissive controller pipe cannot relax a
 * stricter global one — the global 400s before the local pipe runs. Branching
 * on the parameter's DTO metatype here is the route-agnostic way to carve out
 * the exemption: exempted DTOs are validated permissively (whitelist still
 * strips unknown fields, we just don't reject them).
 */
@Injectable()
export class GlobalValidationPipe extends ValidationPipe {
    // Permissive sibling for exempted DTOs: keeps whitelist stripping + transform
    // but drops forbidNonWhitelisted so provider-side field additions don't 400.
    private readonly permissive = new ValidationPipe({ whitelist: true, transform: true });

    // DTOs received from external systems whose payload shape we don't own.
    // Add a webhook/callback DTO here when it must tolerate undeclared fields.
    private static readonly PERMISSIVE_DTOS: ReadonlySet<unknown> = new Set<unknown>([
        EformsignWebhookPayloadDto,
    ]);

    override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
        if (metadata.metatype && GlobalValidationPipe.PERMISSIVE_DTOS.has(metadata.metatype)) {
            return this.permissive.transform(value, metadata);
        }
        return super.transform(value, metadata);
    }
}
