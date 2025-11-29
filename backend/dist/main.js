"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
BigInt.prototype.toJSON = function () {
    return this.toString();
};
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, cookie_parser_1.default)());
    const allowedOrigins = [
        process.env.PRODUCTION_FRONTEND_URL,
        process.env.DEVELOPMENT_FRONTEND_URL,
        "http://localhost:3000",
    ].filter(Boolean);
    console.log("Allowed CORS origins:", allowedOrigins);
    app.enableCors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    });
    app.getHttpAdapter().get("/", (req, res) => {
        res.send("Server is running");
    });
    await app.listen(3001);
    console.log("Server is running");
}
bootstrap();
//# sourceMappingURL=main.js.map