"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientModule = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../application/usecases/client");
const client_repository_interface_1 = require("../domain/repositories/client.repository.interface");
const sb_client_repository_1 = require("../infrastructure/database/repositories/sb.client.repository");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
const client_service_1 = require("../application/services/client.service");
const client_controller_1 = require("../interface/controllers/client.controller");
let ClientModule = class ClientModule {
};
exports.ClientModule = ClientModule;
exports.ClientModule = ClientModule = __decorate([
    (0, common_1.Module)({
        controllers: [client_controller_1.ClientController],
        providers: [
            client_1.CreateClientUsecase,
            client_1.DeleteClientUsecase,
            client_1.FindClientByIdUsecase,
            client_1.ListClientsUsecase,
            client_1.UpdateClientUsecase,
            client_service_1.ClientService,
            prisma_service_1.PrismaService,
            {
                provide: client_repository_interface_1.CLIENT_REPOSITORY,
                useClass: sb_client_repository_1.SbClientRepository,
            },
        ],
        exports: [client_service_1.ClientService],
    })
], ClientModule);
//# sourceMappingURL=client.module.js.map