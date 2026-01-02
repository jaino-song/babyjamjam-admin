import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import cookieParser from "cookie-parser";

// Catch any unhandled errors
process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Add BigInt serialization support (env reloaded)
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // CORS configuration - support both production and development origins
    const allowedOrigins = [
        process.env.PRODUCTION_FRONTEND_URL,
        process.env.DEVELOPMENT_FRONTEND_URL,
        "http://localhost:3000", // Fallback for local development
    ].filter(Boolean); // Remove undefined values

    console.log("Allowed CORS origins:", allowedOrigins);

    app.enableCors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    });

    // Health check endpoint
    app.getHttpAdapter().get("/", (req, res) => {
        res.send("Server is running");
    });

    // WARNING: DO NOT CHANGE - Railway Deployment Configuration
    // The port MUST be hardcoded to 3001 and "nest start" must be used.
    // Changing to process.env.PORT or "node dist/main" will break Railway deployment.
    // See commit 993b0d63 for details on why this configuration is required.
    await app.listen(3001);
    console.log("Server is running");
}
bootstrap();
