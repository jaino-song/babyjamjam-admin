export const INITIAL_SIGN_REQUEST_DOCUMENT_RECORD = {
  statusType: "060",
  statusDetail: "서명 요청됨",
  stepType: "01",
  stepIndex: "1",
  stepName: "서명 요청",
  stepRecipientType: "01",
} as const;

interface BuildInitialSignRequestDocRecordParams {
  documentId: string;
  clientId: number;
  stepRecipientName: string;
  stepRecipientSms: string;
  expiredDate: string;
  linkToClient?: boolean;
}

export function buildInitialSignRequestDocRecord(params: BuildInitialSignRequestDocRecordParams) {
  return {
    ...INITIAL_SIGN_REQUEST_DOCUMENT_RECORD,
    ...params,
  };
}
