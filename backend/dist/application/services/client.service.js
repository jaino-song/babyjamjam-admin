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
exports.ClientService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../usecases/client");
let ClientService = class ClientService {
    constructor(createClientUsecase, findClientByIdUsecase, listClientsUsecase, updateClientUsecase, deleteClientUsecase) {
        this.createClientUsecase = createClientUsecase;
        this.findClientByIdUsecase = findClientByIdUsecase;
        this.listClientsUsecase = listClientsUsecase;
        this.updateClientUsecase = updateClientUsecase;
        this.deleteClientUsecase = deleteClientUsecase;
    }
    create(params) {
        return this.createClientUsecase.execute({
            name: params.name,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId ?? null,
            address: params.address ?? null,
            phone: params.phone ?? null,
            type: params.type ?? null,
            duration: params.duration ?? null,
            fullPrice: params.fullPrice ?? null,
            grant: params.grant ?? null,
            actualPrice: params.actualPrice ?? null,
            startDate: params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
        });
    }
    findAll() {
        return this.listClientsUsecase.execute();
    }
    findById(id) {
        return this.findClientByIdUsecase.execute(id);
    }
    update(id, params) {
        return this.updateClientUsecase.execute(id, {
            name: params.name,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId,
            address: params.address,
            phone: params.phone,
            type: params.type,
            duration: params.duration,
            fullPrice: params.fullPrice,
            grant: params.grant,
            actualPrice: params.actualPrice,
            startDate: params.startDate === undefined ? undefined : params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate === undefined ? undefined : params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
        });
    }
    delete(id) {
        return this.deleteClientUsecase.execute(id);
    }
};
exports.ClientService = ClientService;
exports.ClientService = ClientService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [client_1.CreateClientUsecase,
        client_1.FindClientByIdUsecase,
        client_1.ListClientsUsecase,
        client_1.UpdateClientUsecase,
        client_1.DeleteClientUsecase])
], ClientService);
//# sourceMappingURL=client.service.js.map