interface SurveyMessageData {
  name: string;
}

export const surveyMsgTemplate = (data: SurveyMessageData): string => 
    `[사회서비스 제공자 품질평가 A등급]

${data.name} 산모님 ~♡

서비스 받으시는 기간 동안 행복한 시간이 되셨나요?

산모신생아건강관리서비스 이용에 대한 모니터링 설문 링크 보내드립니다~ 서비스 종료에 꼭 필요한 단계이오니 7일 이내로 모니터링 설문을 완료해 주세요~

산모님 가정에 항상 행복과 평안이 가득하길 바라겠습니다 :)

모니터링 설문 링크: https://naver.me/5S9fl3OP

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`;