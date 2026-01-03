interface ReminderMessageData {
  name: string;
}

export const reminderMsgTemplate = (data: ReminderMessageData): string => 
    `[인천 아이미래로]
    ${data.name} 산모님~♡

    아가 예뻐하시고 케어 잘하시는 
    프리미엄급 관리사님으로 매칭 되도록 최대한 신경쓰겠습니다~
    
    저도 서비스가 종료되는 때까지 산모님께서 
    편안하고 행복하게 서비스 받으시는지 
    지속적으로 체크하고 신경 써서 
    산모님께서 만족하시는 서비스가 되도록 최선을 다하겠습니다 :)
    
    가족 분들과 편히 상의하시고 말씀해 주세요~ 연락 기다리겠습니다 :) 
    
    감사합니다~!`;