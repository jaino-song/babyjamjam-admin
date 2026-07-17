export class ClientHasCompletedServiceRecordError extends Error {
    constructor(message = "Client has a completed or submitted service record") {
        super(message);
        this.name = "ClientHasCompletedServiceRecordError";
    }
}
