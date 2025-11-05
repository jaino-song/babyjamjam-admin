import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as cookieParser from "cookie-parser";

// Add BigInt serialization support
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    app.enableCors({
        origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
        credentials: true,
    });
    await app.listen(3001);
}
bootstrap();

