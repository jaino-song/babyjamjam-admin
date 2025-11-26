import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import cookieParser from "cookie-parser";

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
    
    // Health check endpoint
    app.getHttpAdapter().get("/", (req, res) => {
        res.send("Server is running");
    });
    
    await app.listen(3001);
    console.log("Server is running on http://localhost:3001");
}
bootstrap();
