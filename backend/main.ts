import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import cookieParser from "cookie-parser";

// Add BigInt serialization support
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

    await app.listen(3001);
    console.log("Server is running");
}
bootstrap();
