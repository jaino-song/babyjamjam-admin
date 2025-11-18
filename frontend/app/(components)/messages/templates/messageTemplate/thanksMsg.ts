interface ThanksMessageData {
  name: string;
}

export const thanksMsgTemplate = (data: ThanksMessageData): string => 
    `[인천 아이미래로]
입금 확인/예약 확정 완료

${data.name} 산모님 ~♡

입금 확인 되었고, 예약도 완료 되었습니다~!

궁금하신 점 있으시면 
언제든지 연락 주시고요~

산모님의 서비스를 잘 준비하고 있겠습니다 :)

예쁜 아가 순산하시면 연락주세요~

감사합니다~!`;