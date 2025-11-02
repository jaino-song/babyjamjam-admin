"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageService = void 0;
const common_1 = require("@nestjs/common");
const message_1 = require("../usecases/message");
let MessageService = class MessageService {
    constructor(createMessageUsecase, findMessageByIdUsecase, updateMessageUsecase, deleteMessageUsecase) {
        this.createMessageUsecase = createMessageUsecase;
        this.findMessageByIdUsecase = findMessageByIdUsecase;
        this.updateMessageUsecase = updateMessageUsecase;
        this.deleteMessageUsecase = deleteMessageUsecase;
    }
    create(title, text) {
        return this.createMessageUsecase.execute(title, text);
    }
    findById(id) {
        return this.findMessageByIdUsecase.execute(id);
    }
    update(id, title, text) {
        return this.updateMessageUsecase.execute(id, title, text);
    }
    delete(id) {
        return this.deleteMessageUsecase.execute(id);
    }
};
exports.MessageService = MessageService;
exports.MessageService = MessageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [message_1.CreateMessageUsecase,
        message_1.FindMessageByIdUsecase,
        message_1.UpdateMessageUsecase,
        message_1.DeleteMessageUsecase])
], MessageService);
//# sourceMappingURL=message.service.js.map