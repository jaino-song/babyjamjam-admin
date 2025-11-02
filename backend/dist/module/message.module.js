"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageModule = void 0;
const common_1 = require("@nestjs/common");
const message_1 = require("../application/usecases/message");
const message_service_1 = require("../application/services/message.service");
const message_repository_interface_1 = require("../domain/repositories/message.repository.interface");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
const sb_message_repository_1 = require("../infrastructure/database/repositories/sb.message.repository");
const message_controller_1 = require("../interface/controllers/message.controller");
let MessageModule = class MessageModule {
};
exports.MessageModule = MessageModule;
exports.MessageModule = MessageModule = __decorate([
    (0, common_1.Module)({
        controllers: [message_controller_1.MessageController],
        providers: [
            message_1.CreateMessageUsecase,
            message_1.FindMessageByIdUsecase,
            message_1.UpdateMessageUsecase,
            message_1.DeleteMessageUsecase,
            message_service_1.MessageService,
            prisma_service_1.PrismaService,
            {
                provide: message_repository_interface_1.MESSAGE_REPOSITORY,
                useClass: sb_message_repository_1.SbMessageRepository,
            },
        ],
        exports: [message_service_1.MessageService],
    })
], MessageModule);
//# sourceMappingURL=message.module.js.map