import { SendSmsMessageDto } from "./message-delivery.dto";

/** Uses the same recipient, body, schedule and association validation as send. */
export class MessageDuplicateCheckDto extends SendSmsMessageDto {}
