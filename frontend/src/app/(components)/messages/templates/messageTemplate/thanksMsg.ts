interface ThanksMessageData {
  name: string;
}

export const thanksMsgTemplate = (data: ThanksMessageData): string => 
    `[사회서비스 제공자 품질평가 A등급]

${data.name} 산모님 ~♡

입금이 확인되어 예약이 완료되었습니다. 산모님의 서비스를 잘 준비하고 있겠습니다. 예쁜 아가 순산하시면 연락주세요 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`;