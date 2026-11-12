/** Protocol only. CHANGED asks the server to verify; it never adopts provider state. */
export const RECOVERY_BRIDGE_CHANNEL = 'babyjamjam:eformsign-recovery';
export const RECOVERY_BRIDGE_VERSION = 1;
export const RECOVERY_BRIDGE_PATH = '/eformsign-recovery-bridge.html';

interface Envelope<T extends string> {
  channel: typeof RECOVERY_BRIDGE_CHANNEL;
  version: typeof RECOVERY_BRIDGE_VERSION;
  nonce: string;
  type: T;
}
export interface RecoveryBridgeIds { companyId: string; templateId: string; documentId: string }
export type RecoveryBridgeInit = Envelope<'INIT'> & RecoveryBridgeIds;
export type RecoveryBridgeReady = Envelope<'READY'>;
export type RecoveryBridgeChanged = Envelope<'CHANGED'>;
export type RecoveryBridgeError = Envelope<'ERROR'>;
export type RecoveryBridgeClose = Envelope<'CLOSE'>;
export type RecoveryBridgeParentMessage = RecoveryBridgeInit | RecoveryBridgeClose;
export type RecoveryBridgeMessage = RecoveryBridgeReady | RecoveryBridgeChanged | RecoveryBridgeError;

export function isRecoveryBridgeNonce(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}
export function createRecoveryBridgeNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
export function isRecoveryBridgeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/\s/.test(value);
}
export function isRecoveryBridgeMessage(value: unknown): value is RecoveryBridgeParentMessage | RecoveryBridgeMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (data.channel !== RECOVERY_BRIDGE_CHANNEL || data.version !== RECOVERY_BRIDGE_VERSION || !isRecoveryBridgeNonce(data.nonce)) return false;
  const keys = ['channel', 'version', 'nonce', 'type'];
  if (data.type === 'INIT') {
    keys.push('companyId', 'templateId', 'documentId');
    if (!isRecoveryBridgeId(data.companyId) || !isRecoveryBridgeId(data.templateId) || !isRecoveryBridgeId(data.documentId)) return false;
  } else if (!['READY', 'CHANGED', 'ERROR', 'CLOSE'].includes(data.type as string)) return false;
  return Object.keys(data).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(data, key));
}
export interface RecoveryBridgePeer { source: Window | null; origin: string; nonce: string }
/** Parent must bind the exact mounted iframe.contentWindow, same origin, and fresh nonce. */
export function isRecoveryBridgeEvent(event: MessageEvent, peer: RecoveryBridgePeer): event is MessageEvent<RecoveryBridgeMessage> {
  return peer.source !== null && peer.origin !== 'null' && peer.origin !== '*' &&
    event.source === peer.source && event.origin === peer.origin && event.data?.nonce === peer.nonce &&
    isRecoveryBridgeMessage(event.data) && ['READY', 'CHANGED', 'ERROR'].includes(event.data.type);
}
export function createRecoveryBridgeInit(nonce: string, ids: RecoveryBridgeIds): RecoveryBridgeInit {
  if (ids === null || typeof ids !== 'object' || Array.isArray(ids) || Object.keys(ids).length !== 3 ||
      !['companyId', 'templateId', 'documentId'].every(key => Object.prototype.hasOwnProperty.call(ids, key))) {
    throw new Error('Invalid recovery bridge initialization');
  }
  const data = { channel: RECOVERY_BRIDGE_CHANNEL, version: RECOVERY_BRIDGE_VERSION, nonce, type: 'INIT' as const, ...ids };
  if (!isRecoveryBridgeMessage(data)) throw new Error('Invalid recovery bridge initialization');
  return data;
}
export function createRecoveryBridgeClose(nonce: string): RecoveryBridgeClose {
  if (!isRecoveryBridgeNonce(nonce)) throw new Error('Invalid recovery bridge nonce');
  return { channel: RECOVERY_BRIDGE_CHANNEL, version: RECOVERY_BRIDGE_VERSION, nonce, type: 'CLOSE' };
}
