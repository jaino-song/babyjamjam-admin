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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateMessageUsecase = void 0;
const common_1 = require("@nestjs/common");
const message_repository_interface_1 = require("../../../domain/repositories/message.repository.interface");
let UpdateMessageUsecase = class UpdateMessageUsecase {
    constructor(messageRepository) {
        this.messageRepository = messageRepository;
    }
    async execute(id, title, text) {
        const message = await this.messageRepository.findById(id);
        if (!message) {
            throw new common_1.NotFoundException(`Message with id ${id} not found`);
        }
        message.edit(title, text);
        return this.messageRepository.update(message);
    }
};
exports.UpdateMessageUsecase = UpdateMessageUsecase;
exports.UpdateMessageUsecase = UpdateMessageUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(message_repository_interface_1.MESSAGE_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], UpdateMessageUsecase);
//# sourceMappingURL=update-message.usecase.js.map