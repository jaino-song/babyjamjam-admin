export interface Schedule {
  id: string;
  time: string;
  clientName: string;
  employeeName: string;
  type: string;
  status: "예정" | "진행중" | "완료";
}

export interface PendingClient {
  id: number;
  name: string;
  phone: string;
  startDate: string;
  type: string;
  careCenter: boolean;
  breastPump: boolean;
  address: string;
  notes: string;
}

export interface MonthlyClientComparison {
  month: string;
  고객수: number;
}

export const todaySchedules: Schedule[] = [
  {
    id: "1",
    time: "09:00",
    clientName: "홍길동",
    employeeName: "김도우미",
    type: "A가1형",
    status: "완료",
  },
  {
    id: "2",
    time: "10:30",
    clientName: "김영희",
    employeeName: "이산후",
    type: "A통합1형",
    status: "진행중",
  },
  {
    id: "3",
    time: "13:00",
    clientName: "이지은",
    employeeName: "박케어",
    type: "B가1형",
    status: "예정",
  },
  {
    id: "4",
    time: "14:30",
    clientName: "한지현",
    employeeName: "최헬퍼",
    type: "A가2형",
    status: "예정",
  },
  {
    id: "5",
    time: "16:00",
    clientName: "박수진",
    employeeName: "정도움",
    type: "A라1형",
    status: "예정",
  },
];

export const pendingClients: PendingClient[] = [
  {
    id: 1,
    name: "박수진",
    phone: "010-4567-8901",
    startDate: "2026-02-05",
    type: "A라1형",
    careCenter: false,
    breastPump: true,
    address: "인천광역시 연수구 송도동 345-67",
    notes: "첫째아 출산 예정, 오전 시간대 선호",
  },
  {
    id: 2,
    name: "정하나",
    phone: "010-6789-0123",
    startDate: "2026-02-08",
    type: "D가2형",
    careCenter: true,
    breastPump: true,
    address: "인천광역시 계양구 계산동 567-89",
    notes: "셋째아 출산, 경험 있는 도우미 요청",
  },
  {
    id: 3,
    name: "윤서연",
    phone: "010-8901-2345",
    startDate: "2026-02-10",
    type: "일반형",
    careCenter: false,
    breastPump: true,
    address: "인천광역시 미추홀구 숭의동 789-01",
    notes: "비바우처 고객, 유축기만 대여",
  },
  {
    id: 4,
    name: "오수빈",
    phone: "010-0123-4567",
    startDate: "2026-02-15",
    type: "C라1형",
    careCenter: false,
    breastPump: false,
    address: "인천광역시 남동구 논현동 901-23",
    notes: "출산 예정일 미정, 일정 조율 필요",
  },
  {
    id: 5,
    name: "임수정",
    phone: "010-1234-5678",
    startDate: "2026-02-20",
    type: "A통합2형",
    careCenter: true,
    breastPump: false,
    address: "인천광역시 부평구 삼산동 012-34",
    notes: "둘째아 출산, 조리원 퇴소 후 서비스 시작",
  },
];

export const monthlyClientComparisonData: MonthlyClientComparison[] = [
  { month: "전월", 고객수: 266 },
  { month: "현월", 고객수: 292 },
];
