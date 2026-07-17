/**
 * Mock Data for Frontend Design
 * Generated based on actual API structures and Prisma schema
 *
 * Usage:
 * - Import specific mock data: import { mockClients, mockEmployees } from '@/mocks/mock-data'
 * - Use in development: if (process.env.NODE_ENV === 'development') { ... }
 */

// ============================================================================
// BRANCH (Multi-Tenancy)
// ============================================================================

export interface Branch {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  ownerId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const mockBranches: Branch[] = [
  {
    id: 'org_01HWXYZ1234567890ABCDEF',
    name: '인천 동구 센터',
    slug: 'incheon-dong',
    description: '인천광역시 동구 지역 돌봄 서비스 센터',
    email: 'dong@imirae-care.co.kr',
    phone: '032-123-4567',
    address: '인천광역시 동구 송림로 123',
    ownerId: 'user_01HWXYZ1234567890ADMIN1',
    isActive: true,
    createdAt: '2024-01-15T09:00:00.000Z',
    updatedAt: '2024-06-01T14:30:00.000Z',
  },
  {
    id: 'org_01HWXYZ1234567890BCDEFG',
    name: '인천 남동구 센터',
    slug: 'incheon-namdong',
    description: '인천광역시 남동구 지역 돌봄 서비스 센터',
    email: 'namdong@imirae-care.co.kr',
    phone: '032-234-5678',
    address: '인천광역시 남동구 인주대로 456',
    ownerId: 'user_01HWXYZ1234567890ADMIN2',
    isActive: true,
    createdAt: '2024-02-01T09:00:00.000Z',
    updatedAt: '2024-06-15T10:00:00.000Z',
  },
  {
    id: 'org_01HWXYZ1234567890CDEFGH',
    name: '인천 연수구 센터',
    slug: 'incheon-yeonsu',
    description: '인천광역시 연수구 지역 돌봄 서비스 센터',
    email: 'yeonsu@imirae-care.co.kr',
    phone: '032-345-6789',
    address: '인천광역시 연수구 센트럴로 789',
    ownerId: 'user_01HWXYZ1234567890ADMIN3',
    isActive: false,
    createdAt: '2024-03-10T09:00:00.000Z',
    updatedAt: '2024-07-01T16:45:00.000Z',
  },
];

// ============================================================================
// USER & AUTHENTICATION
// ============================================================================

export interface User {
  id: string;
  kakaoId: string;
  email: string | null;
  name: string | null;
  profileImage: string | null;
  role: 'admin' | 'manager' | 'user' | null;
  createdAt: string;
}

export interface UserBranch {
  id: string;
  userId: string;
  branchId: string;
  role: 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

export const mockUsers: User[] = [
  {
    id: 'user_01HWXYZ1234567890ADMIN1',
    kakaoId: '1234567890',
    email: 'admin@imirae-care.co.kr',
    name: '김관리',
    profileImage: 'https://k.kakaocdn.net/dn/example/profile1.jpg',
    role: 'admin',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'user_01HWXYZ1234567890MNGR01',
    kakaoId: '2345678901',
    email: 'manager1@imirae-care.co.kr',
    name: '이매니저',
    profileImage: 'https://k.kakaocdn.net/dn/example/profile2.jpg',
    role: 'manager',
    createdAt: '2024-02-15T00:00:00.000Z',
  },
  {
    id: 'user_01HWXYZ1234567890USER01',
    kakaoId: '3456789012',
    email: 'staff1@imirae-care.co.kr',
    name: '박직원',
    profileImage: null,
    role: 'user',
    createdAt: '2024-03-01T00:00:00.000Z',
  },
  {
    id: 'user_01HWXYZ1234567890USER02',
    kakaoId: '4567890123',
    email: null,
    name: '최신입',
    profileImage: 'https://k.kakaocdn.net/dn/example/profile4.jpg',
    role: 'user',
    createdAt: '2024-06-01T00:00:00.000Z',
  },
];

export const mockUserBranches: UserBranch[] = [
  {
    id: 'uo_01HWXYZ0001',
    userId: 'user_01HWXYZ1234567890ADMIN1',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    role: 'admin',
    joinedAt: '2024-01-15T09:00:00.000Z',
  },
  {
    id: 'uo_01HWXYZ0002',
    userId: 'user_01HWXYZ1234567890MNGR01',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    role: 'member',
    joinedAt: '2024-02-20T09:00:00.000Z',
  },
  {
    id: 'uo_01HWXYZ0003',
    userId: 'user_01HWXYZ1234567890USER01',
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    role: 'member',
    joinedAt: '2024-03-05T09:00:00.000Z',
  },
];

// ============================================================================
// CLIENT (Service Recipients - 수급자)
// ============================================================================

export type ServiceStatus =
  | 'active'
  | 'pre_booking'
  | 'waiting'
  | 'completed'
  | 'terminated'
  | 'replacement_requested';

export interface Client {
  id: number;
  branchId: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  type: string | null;
  duration: number | null;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
  startDate: string | null;
  endDate: string | null;
  careCenter: boolean;
  voucherClient: boolean;
  birthday: string | null;
  dueDate: string | null;
  serviceStatus: ServiceStatus | null;
  breastPump: boolean;
  eDocId: string | null;
}

export const mockClients: Client[] = [
  {
    id: 1,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '홍길동',
    address: '인천광역시 동구 송림동 123-45',
    phone: '010-1234-5678',
    type: '가형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '1,312,000',
    actualPrice: '328,000',
    startDate: '2024-08-01T00:00:00.000Z',
    endDate: '2024-08-31T23:59:59.000Z',
    careCenter: false,
    voucherClient: true,
    birthday: '940315',
    dueDate: '2024-09-15T00:00:00.000Z',
    serviceStatus: 'active',
    breastPump: false,
    eDocId: 'edoc_12345678',
  },
  {
    id: 2,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '김영희',
    address: '인천광역시 동구 화수동 67-89',
    phone: '010-2345-6789',
    type: '나형',
    duration: 15,
    fullPrice: '1,230,000',
    grant: '984,000',
    actualPrice: '246,000',
    startDate: '2024-07-15T00:00:00.000Z',
    endDate: '2024-09-15T23:59:59.000Z',
    careCenter: true,
    voucherClient: true,
    birthday: '891220',
    dueDate: '2024-10-01T00:00:00.000Z',
    serviceStatus: 'active',
    breastPump: true,
    eDocId: 'edoc_23456789',
  },
  {
    id: 3,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '이철수',
    address: '인천광역시 동구 금곡동 111-22',
    phone: '010-3456-7890',
    type: '가형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '1,312,000',
    actualPrice: '328,000',
    startDate: '2024-09-01T00:00:00.000Z',
    endDate: null,
    careCenter: false,
    voucherClient: true,
    birthday: '920508',
    dueDate: '2024-09-30T00:00:00.000Z',
    serviceStatus: 'waiting',
    breastPump: false,
    eDocId: null,
  },
  {
    id: 4,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '박미영',
    address: '인천광역시 동구 송현동 45-67',
    phone: '010-4567-8901',
    type: '다형',
    duration: 10,
    fullPrice: '820,000',
    grant: '656,000',
    actualPrice: '164,000',
    startDate: '2024-05-01T00:00:00.000Z',
    endDate: '2024-07-31T23:59:59.000Z',
    careCenter: false,
    voucherClient: true,
    birthday: '880127',
    dueDate: null,
    serviceStatus: 'completed',
    breastPump: false,
    eDocId: 'edoc_34567890',
  },
  {
    id: 5,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '정수진',
    address: '인천광역시 동구 만석동 88-99',
    phone: '010-5678-9012',
    type: '가형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '1,312,000',
    actualPrice: '328,000',
    startDate: '2024-06-01T00:00:00.000Z',
    endDate: '2024-08-10T23:59:59.000Z',
    careCenter: true,
    voucherClient: true,
    birthday: '950812',
    dueDate: null,
    serviceStatus: 'terminated',
    breastPump: true,
    eDocId: 'edoc_45678901',
  },
  {
    id: 6,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    name: '최동훈',
    address: '인천광역시 남동구 구월동 123-45',
    phone: '010-6789-0123',
    type: '나형',
    duration: 15,
    fullPrice: '1,230,000',
    grant: '984,000',
    actualPrice: '246,000',
    startDate: '2024-08-15T00:00:00.000Z',
    endDate: '2024-10-15T23:59:59.000Z',
    careCenter: false,
    voucherClient: true,
    birthday: '900623',
    dueDate: '2024-11-01T00:00:00.000Z',
    serviceStatus: 'replacement_requested',
    breastPump: false,
    eDocId: 'edoc_56789012',
  },
  {
    id: 7,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    name: '윤서연',
    address: '인천광역시 남동구 간석동 67-89',
    phone: '010-7890-1234',
    type: '가형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '0',
    actualPrice: '1,640,000',
    startDate: '2024-07-01T00:00:00.000Z',
    endDate: '2024-08-31T23:59:59.000Z',
    careCenter: false,
    voucherClient: false,
    birthday: '930405',
    dueDate: null,
    serviceStatus: 'terminated',
    breastPump: false,
    eDocId: null,
  },
];

// ============================================================================
// EMPLOYEE (Care Providers - 제공인력)
// ============================================================================

export type EmployeeStatus = 'available' | 'working' | 'unavailable';

export interface Employee {
  id: number;
  branchId: string | null;
  name: string;
  workArea: string[];
  phone: string;
  grade: string;
  openToNextWork: boolean;
  companyRegisteredDate: string | null;
  // Computed field
  status?: EmployeeStatus;
}

export const mockEmployees: Employee[] = [
  {
    id: 1,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '강서희',
    workArea: ['동구', '중구', '미추홀구'],
    phone: '010-1111-2222',
    grade: '프리미엄',
    openToNextWork: true,
    companyRegisteredDate: '2022-03-15T00:00:00.000Z',
    status: 'working',
  },
  {
    id: 2,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '임재현',
    workArea: ['동구', '연수구'],
    phone: '010-2222-3333',
    grade: '베스트',
    openToNextWork: true,
    companyRegisteredDate: '2023-01-10T00:00:00.000Z',
    status: 'available',
  },
  {
    id: 3,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '송미라',
    workArea: ['동구'],
    phone: '010-3333-4444',
    grade: '프리미엄',
    openToNextWork: false,
    companyRegisteredDate: '2021-06-20T00:00:00.000Z',
    status: 'working',
  },
  {
    id: 4,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '조현우',
    workArea: ['동구', '남동구', '부평구'],
    phone: '010-4444-5555',
    grade: '베스트',
    openToNextWork: true,
    companyRegisteredDate: '2023-08-01T00:00:00.000Z',
    status: 'available',
  },
  {
    id: 5,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '한지민',
    workArea: ['동구', '중구'],
    phone: '010-5555-6666',
    grade: '프리미엄',
    openToNextWork: false,
    companyRegisteredDate: '2020-11-05T00:00:00.000Z',
    status: 'unavailable',
  },
  {
    id: 6,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    name: '백승호',
    workArea: ['남동구', '연수구'],
    phone: '010-6666-7777',
    grade: '베스트',
    openToNextWork: true,
    companyRegisteredDate: '2022-09-15T00:00:00.000Z',
    status: 'working',
  },
  {
    id: 7,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    name: '오은영',
    workArea: ['남동구'],
    phone: '010-7777-8888',
    grade: '프리미엄',
    openToNextWork: true,
    companyRegisteredDate: '2019-04-20T00:00:00.000Z',
    status: 'available',
  },
];

// ============================================================================
// EMPLOYEE SCHEDULE (Assignments)
// ============================================================================

export interface EmployeeSchedule {
  id: number;
  branchId: string | null;
  clientId: number;
  primaryEmployeeId: number;
  secondaryEmployeeId: number | null;
  workAddress: string;
  startDate: string;
  endDate: string;
  replaced: boolean;
  // Relations (denormalized for convenience)
  client?: Pick<Client, 'id' | 'name' | 'phone'>;
  primaryEmployee?: Pick<Employee, 'id' | 'name' | 'phone'>;
  secondaryEmployee?: Pick<Employee, 'id' | 'name' | 'phone'> | null;
}

export const mockEmployeeSchedules: EmployeeSchedule[] = [
  {
    id: 1,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    clientId: 1,
    primaryEmployeeId: 1,
    secondaryEmployeeId: 2,
    workAddress: '인천광역시 동구 송림동 123-45',
    startDate: '2024-08-01T00:00:00.000Z',
    endDate: '2024-08-31T23:59:59.000Z',
    replaced: false,
    client: { id: 1, name: '홍길동', phone: '010-1234-5678' },
    primaryEmployee: { id: 1, name: '강서희', phone: '010-1111-2222' },
    secondaryEmployee: { id: 2, name: '임재현', phone: '010-2222-3333' },
  },
  {
    id: 2,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    clientId: 2,
    primaryEmployeeId: 3,
    secondaryEmployeeId: null,
    workAddress: '인천광역시 동구 화수동 67-89',
    startDate: '2024-07-15T00:00:00.000Z',
    endDate: '2024-09-15T23:59:59.000Z',
    replaced: false,
    client: { id: 2, name: '김영희', phone: '010-2345-6789' },
    primaryEmployee: { id: 3, name: '송미라', phone: '010-3333-4444' },
    secondaryEmployee: null,
  },
  {
    id: 3,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    clientId: 5,
    primaryEmployeeId: 1,
    secondaryEmployeeId: 4,
    workAddress: '인천광역시 동구 만석동 88-99',
    startDate: '2024-06-01T00:00:00.000Z',
    endDate: '2024-08-10T23:59:59.000Z',
    replaced: true,
    client: { id: 5, name: '정수진', phone: '010-5678-9012' },
    primaryEmployee: { id: 1, name: '강서희', phone: '010-1111-2222' },
    secondaryEmployee: { id: 4, name: '조현우', phone: '010-4444-5555' },
  },
  {
    id: 4,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    clientId: 6,
    primaryEmployeeId: 6,
    secondaryEmployeeId: 7,
    workAddress: '인천광역시 남동구 구월동 123-45',
    startDate: '2024-08-15T00:00:00.000Z',
    endDate: '2024-10-15T23:59:59.000Z',
    replaced: false,
    client: { id: 6, name: '최동훈', phone: '010-6789-0123' },
    primaryEmployee: { id: 6, name: '백승호', phone: '010-6666-7777' },
    secondaryEmployee: { id: 7, name: '오은영', phone: '010-7777-8888' },
  },
];

// ============================================================================
// AREA (Service Regions)
// ============================================================================

export interface Area {
  id: string;
  name: string;
  koreanName: string;
  branchId: string | null;
}

export const mockAreas: Area[] = [
  {
    id: 'area_dong',
    name: 'dong',
    koreanName: '동구',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
  },
  {
    id: 'area_jung',
    name: 'jung',
    koreanName: '중구',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
  },
  {
    id: 'area_namdong',
    name: 'namdong',
    koreanName: '남동구',
    branchId: 'org_01HWXYZ1234567890BCDEFG',
  },
  {
    id: 'area_yeonsu',
    name: 'yeonsu',
    koreanName: '연수구',
    branchId: 'org_01HWXYZ1234567890CDEFGH',
  },
  {
    id: 'area_bupyeong',
    name: 'bupyeong',
    koreanName: '부평구',
    branchId: null,
  },
  {
    id: 'area_michuhol',
    name: 'michuhol',
    koreanName: '미추홀구',
    branchId: null,
  },
];

// ============================================================================
// BANK ACCOUNT INFO
// ============================================================================

export interface BankAccountInfo {
  areaId: string;
  bankName: string | null;
  accNum: string | null;
}

export const mockBankAccountInfos: BankAccountInfo[] = [
  {
    areaId: 'area_dong',
    bankName: '국민은행',
    accNum: '123-456-789012',
  },
  {
    areaId: 'area_jung',
    bankName: '신한은행',
    accNum: '110-234-567890',
  },
  {
    areaId: 'area_namdong',
    bankName: '우리은행',
    accNum: '1002-345-678901',
  },
  {
    areaId: 'area_yeonsu',
    bankName: '하나은행',
    accNum: '111-22-33333-4',
  },
];

// ============================================================================
// MESSAGE (Broadcast Messages)
// ============================================================================

export interface Message {
  id: number;
  branchId: string | null;
  title: string;
  text: string | null;
  createdAt: string;
  editedAt: string | null;
}

export const mockMessages: Message[] = [
  {
    id: 1,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '8월 급여 지급 안내',
    text: '8월 급여가 정상적으로 지급되었습니다. 확인 부탁드립니다.',
    createdAt: '2024-08-25T09:00:00.000Z',
    editedAt: null,
  },
  {
    id: 2,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '추석 연휴 일정 안내',
    text: '추석 연휴 기간(9월 14일~18일) 동안 비상 연락망을 확인해주세요. 긴급 상황 시 대표번호로 연락 바랍니다.',
    createdAt: '2024-09-01T10:30:00.000Z',
    editedAt: '2024-09-02T08:15:00.000Z',
  },
  {
    id: 3,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '신규 매뉴얼 배포',
    text: '새로운 서비스 매뉴얼이 배포되었습니다. 첨부된 파일을 다운로드하여 확인해주세요.',
    createdAt: '2024-08-15T14:00:00.000Z',
    editedAt: null,
  },
  {
    id: 4,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    title: '남동구 센터 직원 교육 일정',
    text: '9월 10일(화) 오후 2시에 직원 교육이 진행됩니다. 참석 부탁드립니다.',
    createdAt: '2024-09-03T11:00:00.000Z',
    editedAt: null,
  },
];

// ============================================================================
// MESSAGE TEMPLATE
// ============================================================================

export type TemplateVariableType =
  | 'text'
  | 'phone'
  | 'select'
  | 'date'
  | 'number'
  | 'textarea';

export interface TemplateVariable {
  key: string;
  type: TemplateVariableType;
  label: string;
  placeholder?: string;
  required: boolean;
  optionType?: 'custom' | 'dataSource';
  options?: string[];
  dataSource?: string;
  min?: number;
  max?: number;
}

export interface MessageTemplate {
  id: string;
  branchId: string | null;
  name: string;
  content: string;
  variables: TemplateVariable[];
  isCustom: boolean;
  createdAt: string;
  updatedAt: string;
}

export const mockMessageTemplates: MessageTemplate[] = [
  {
    id: 'tmpl_01HWXYZ001',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '서비스 시작 안내',
    content:
      '안녕하세요, {{clientName}}님. {{startDate}}부터 {{employeeName}} 선생님이 돌봄 서비스를 제공해 드릴 예정입니다. 문의사항이 있으시면 {{contactPhone}}으로 연락 부탁드립니다.',
    variables: [
      {
        key: 'clientName',
        type: 'text',
        label: '수급자명',
        placeholder: '홍길동',
        required: true,
      },
      {
        key: 'startDate',
        type: 'date',
        label: '서비스 시작일',
        required: true,
      },
      {
        key: 'employeeName',
        type: 'text',
        label: '제공인력명',
        placeholder: '김선생',
        required: true,
        optionType: 'dataSource',
        dataSource: 'employees',
      },
      {
        key: 'contactPhone',
        type: 'phone',
        label: '연락처',
        placeholder: '032-123-4567',
        required: true,
      },
    ],
    isCustom: true,
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
  },
  {
    id: 'tmpl_01HWXYZ002',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '서비스 종료 안내',
    content:
      '{{clientName}}님, {{endDate}}자로 돌봄 서비스가 종료되었습니다. 그동안 이용해 주셔서 감사합니다. {{additionalMessage}}',
    variables: [
      {
        key: 'clientName',
        type: 'text',
        label: '수급자명',
        required: true,
      },
      {
        key: 'endDate',
        type: 'date',
        label: '서비스 종료일',
        required: true,
      },
      {
        key: 'additionalMessage',
        type: 'textarea',
        label: '추가 메시지',
        placeholder: '추가로 전달할 내용이 있으면 입력하세요',
        required: false,
      },
    ],
    isCustom: true,
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-07-15T10:30:00.000Z',
  },
  {
    id: 'tmpl_01HWXYZ003',
    branchId: null,
    name: '제공인력 교체 안내',
    content:
      '안녕하세요, {{clientName}}님. {{changeReason}}으로 인해 제공인력이 {{previousEmployee}}에서 {{newEmployee}}로 변경되었습니다. {{changeDate}}부터 새로운 선생님이 방문 예정입니다.',
    variables: [
      {
        key: 'clientName',
        type: 'text',
        label: '수급자명',
        required: true,
      },
      {
        key: 'changeReason',
        type: 'select',
        label: '변경 사유',
        required: true,
        optionType: 'custom',
        options: ['개인 사정', '건강 문제', '일정 조정', '수급자 요청', '기타'],
      },
      {
        key: 'previousEmployee',
        type: 'text',
        label: '기존 제공인력',
        required: true,
      },
      {
        key: 'newEmployee',
        type: 'text',
        label: '새 제공인력',
        required: true,
      },
      {
        key: 'changeDate',
        type: 'date',
        label: '변경일',
        required: true,
      },
    ],
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'tmpl_01HWXYZ004',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    name: '급여 지급 안내',
    content:
      '{{employeeName}}님, {{paymentMonth}} 급여 {{amount}}원이 {{paymentDate}}에 지급되었습니다. 확인 부탁드립니다.',
    variables: [
      {
        key: 'employeeName',
        type: 'text',
        label: '제공인력명',
        required: true,
      },
      {
        key: 'paymentMonth',
        type: 'text',
        label: '급여 월',
        placeholder: '2024년 8월',
        required: true,
      },
      {
        key: 'amount',
        type: 'number',
        label: '금액',
        required: true,
        min: 0,
      },
      {
        key: 'paymentDate',
        type: 'date',
        label: '지급일',
        required: true,
      },
    ],
    isCustom: true,
    createdAt: '2024-07-01T00:00:00.000Z',
    updatedAt: '2024-07-01T00:00:00.000Z',
  },
];

// ============================================================================
// SYSTEM TEMPLATE
// ============================================================================

export type SystemTemplateKey =
  | 'SERVICE_START_NOTIFICATION'
  | 'SERVICE_END_NOTIFICATION'
  | 'EMPLOYEE_CHANGE_NOTIFICATION'
  | 'PAYMENT_CONFIRMATION'
  | 'SCHEDULE_REMINDER';

export interface CustomVariable {
  key: string;
  type: string;
  label: string;
  defaultValue?: string;
}

export interface SystemTemplate {
  id: string;
  templateKey: SystemTemplateKey;
  content: string;
  customVariables: CustomVariable[];
  createdAt: string;
  updatedAt: string;
}

export const mockSystemTemplates: SystemTemplate[] = [
  {
    id: 'sys_tmpl_001',
    templateKey: 'SERVICE_START_NOTIFICATION',
    content:
      '[이미래 인천] {{clientName}}님의 돌봄 서비스가 {{startDate}}부터 시작됩니다. 담당 제공인력: {{employeeName}}',
    customVariables: [
      {
        key: 'clientName',
        type: 'text',
        label: '수급자명',
      },
      {
        key: 'startDate',
        type: 'date',
        label: '시작일',
      },
      {
        key: 'employeeName',
        type: 'text',
        label: '제공인력명',
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-06-15T10:00:00.000Z',
  },
  {
    id: 'sys_tmpl_002',
    templateKey: 'SCHEDULE_REMINDER',
    content:
      '[이미래 인천] {{employeeName}}님, 내일 {{visitTime}}에 {{clientName}}님 댁 방문 예정입니다. 주소: {{address}}',
    customVariables: [
      {
        key: 'employeeName',
        type: 'text',
        label: '제공인력명',
      },
      {
        key: 'visitTime',
        type: 'text',
        label: '방문 시간',
        defaultValue: '09:00',
      },
      {
        key: 'clientName',
        type: 'text',
        label: '수급자명',
      },
      {
        key: 'address',
        type: 'text',
        label: '주소',
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

// ============================================================================
// NOTIFICATION
// ============================================================================

export interface Notification {
  id: number;
  userId: string;
  branchId: string | null;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  sentAt: string;
  readAt: string | null;
}

export const mockNotifications: Notification[] = [
  {
    id: 1,
    userId: 'user_01HWXYZ1234567890ADMIN1',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '새로운 수급자 등록',
    body: '이철수님이 새로운 수급자로 등록되었습니다.',
    data: { clientId: 3, type: 'CLIENT_REGISTERED' },
    sentAt: '2024-08-28T09:15:00.000Z',
    readAt: '2024-08-28T09:20:00.000Z',
  },
  {
    id: 2,
    userId: 'user_01HWXYZ1234567890ADMIN1',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '서비스 종료 알림',
    body: '정수진님의 서비스가 오늘 종료되었습니다.',
    data: { clientId: 5, type: 'SERVICE_ENDED' },
    sentAt: '2024-08-10T18:00:00.000Z',
    readAt: null,
  },
  {
    id: 3,
    userId: 'user_01HWXYZ1234567890MNGR01',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '제공인력 교체 요청',
    body: '최동훈님이 제공인력 교체를 요청하였습니다.',
    data: { clientId: 6, type: 'REPLACEMENT_REQUESTED' },
    sentAt: '2024-08-30T14:30:00.000Z',
    readAt: null,
  },
  {
    id: 4,
    userId: 'user_01HWXYZ1234567890ADMIN1',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    title: '전자문서 서명 완료',
    body: '홍길동님의 계약서 서명이 완료되었습니다.',
    data: { clientId: 1, eDocId: 'edoc_12345678', type: 'EDOC_SIGNED' },
    sentAt: '2024-08-01T10:45:00.000Z',
    readAt: '2024-08-01T11:00:00.000Z',
  },
  {
    id: 5,
    userId: 'user_01HWXYZ1234567890USER01',
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    title: '시스템 공지',
    body: '9월 정기 점검이 예정되어 있습니다.',
    data: { type: 'SYSTEM_NOTICE' },
    sentAt: '2024-09-01T08:00:00.000Z',
    readAt: null,
  },
];

// ============================================================================
// DOCUMENT & DOCUMENT CATEGORY
// ============================================================================

export interface DocumentCategory {
  id: string;
  branchId: string | null;
  value: string;
  label: string;
  color: string;
  isCustom: boolean;
  createdAt: string;
}

export const mockDocumentCategories: DocumentCategory[] = [
  {
    id: 'cat_contract',
    branchId: null,
    value: 'contract',
    label: '계약서',
    color: 'primary',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_invoice',
    branchId: null,
    value: 'invoice',
    label: '청구서',
    color: 'secondary',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_receipt',
    branchId: null,
    value: 'receipt',
    label: '영수증',
    color: 'success',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_report',
    branchId: null,
    value: 'report',
    label: '보고서',
    color: 'info',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_certificate',
    branchId: null,
    value: 'certificate',
    label: '증명서',
    color: 'warning',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_form',
    branchId: null,
    value: 'form',
    label: '양식',
    color: 'default',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_notice',
    branchId: null,
    value: 'notice',
    label: '안내문',
    color: 'error',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_employee_contract',
    branchId: null,
    value: 'employee-contract',
    label: '제공인력 계약서',
    color: 'primary',
    isCustom: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'cat_custom_001',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    value: 'training-material',
    label: '교육자료',
    color: 'info',
    isCustom: true,
    createdAt: '2024-03-15T00:00:00.000Z',
  },
];

export interface Document {
  id: string;
  branchId: string | null;
  categoryId: string;
  name: string;
  description: string | null;
  tags: string[];
  mimeType: 'image/png' | 'image/jpeg' | 'application/pdf';
  fileSize: number;
  storagePath: string;
  storageUrl: string | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  // Denormalized for convenience
  category?: DocumentCategory;
}

export const mockDocuments: Document[] = [
  {
    id: 'doc_01HWXYZ001',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    categoryId: 'cat_contract',
    name: '홍길동_서비스계약서_202408.pdf',
    description: '2024년 8월 서비스 계약서',
    tags: ['계약서', '홍길동', '2024년'],
    mimeType: 'application/pdf',
    fileSize: 245678,
    storagePath: '/documents/contracts/hong-2024-08.pdf',
    storageUrl:
      'https://storage.example.com/documents/contracts/hong-2024-08.pdf',
    uploadedBy: 'user_01HWXYZ1234567890ADMIN1',
    createdAt: '2024-08-01T10:00:00.000Z',
    updatedAt: '2024-08-01T10:00:00.000Z',
  },
  {
    id: 'doc_01HWXYZ002',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    categoryId: 'cat_employee_contract',
    name: '강서희_근로계약서_2022.pdf',
    description: '2022년 입사 근로계약서',
    tags: ['근로계약', '강서희', '2022년'],
    mimeType: 'application/pdf',
    fileSize: 189432,
    storagePath: '/documents/employee-contracts/kang-2022.pdf',
    storageUrl:
      'https://storage.example.com/documents/employee-contracts/kang-2022.pdf',
    uploadedBy: 'user_01HWXYZ1234567890ADMIN1',
    createdAt: '2022-03-15T09:00:00.000Z',
    updatedAt: '2022-03-15T09:00:00.000Z',
  },
  {
    id: 'doc_01HWXYZ003',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    categoryId: 'cat_certificate',
    name: '임재현_자격증_2급.jpg',
    description: '돌봄서비스 2급 자격증',
    tags: ['자격증', '임재현', '2급'],
    mimeType: 'image/jpeg',
    fileSize: 567890,
    storagePath: '/documents/certificates/lim-grade2.jpg',
    storageUrl:
      'https://storage.example.com/documents/certificates/lim-grade2.jpg',
    uploadedBy: 'user_01HWXYZ1234567890MNGR01',
    createdAt: '2023-01-10T14:30:00.000Z',
    updatedAt: '2023-01-10T14:30:00.000Z',
  },
  {
    id: 'doc_01HWXYZ004',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    categoryId: 'cat_report',
    name: '2024년_8월_월간보고서.pdf',
    description: '동구 센터 2024년 8월 월간 보고서',
    tags: ['월간보고서', '2024년', '8월'],
    mimeType: 'application/pdf',
    fileSize: 1234567,
    storagePath: '/documents/reports/monthly-2024-08.pdf',
    storageUrl:
      'https://storage.example.com/documents/reports/monthly-2024-08.pdf',
    uploadedBy: 'user_01HWXYZ1234567890ADMIN1',
    createdAt: '2024-09-01T09:00:00.000Z',
    updatedAt: '2024-09-01T09:00:00.000Z',
  },
  {
    id: 'doc_01HWXYZ005',
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    categoryId: 'cat_custom_001',
    name: '신입직원_교육자료_v2.pdf',
    description: '신입 제공인력 교육용 자료',
    tags: ['교육', '신입', '매뉴얼'],
    mimeType: 'application/pdf',
    fileSize: 3456789,
    storagePath: '/documents/training/new-employee-v2.pdf',
    storageUrl:
      'https://storage.example.com/documents/training/new-employee-v2.pdf',
    uploadedBy: 'user_01HWXYZ1234567890MNGR01',
    createdAt: '2024-07-01T11:00:00.000Z',
    updatedAt: '2024-08-15T16:30:00.000Z',
  },
];

// ============================================================================
// VOUCHER PRICE INFO
// ============================================================================

export interface VoucherPriceInfo {
  id: number;
  year: number;
  type: string | null;
  duration: number | null;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
}

export const mockVoucherPriceInfos: VoucherPriceInfo[] = [
  // 2024년 가형
  {
    id: 1,
    year: 2024,
    type: '가형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '1,312,000',
    actualPrice: '328,000',
  },
  {
    id: 2,
    year: 2024,
    type: '가형',
    duration: 15,
    fullPrice: '1,230,000',
    grant: '984,000',
    actualPrice: '246,000',
  },
  // 2024년 나형
  {
    id: 3,
    year: 2024,
    type: '나형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '1,148,000',
    actualPrice: '492,000',
  },
  {
    id: 4,
    year: 2024,
    type: '나형',
    duration: 15,
    fullPrice: '1,230,000',
    grant: '861,000',
    actualPrice: '369,000',
  },
  // 2024년 다형
  {
    id: 5,
    year: 2024,
    type: '다형',
    duration: 20,
    fullPrice: '1,640,000',
    grant: '984,000',
    actualPrice: '656,000',
  },
  {
    id: 6,
    year: 2024,
    type: '다형',
    duration: 15,
    fullPrice: '1,230,000',
    grant: '738,000',
    actualPrice: '492,000',
  },
  {
    id: 7,
    year: 2024,
    type: '다형',
    duration: 10,
    fullPrice: '820,000',
    grant: '656,000',
    actualPrice: '164,000',
  },
  // 2023년 (이전 연도 참고용)
  {
    id: 8,
    year: 2023,
    type: '가형',
    duration: 20,
    fullPrice: '1,560,000',
    grant: '1,248,000',
    actualPrice: '312,000',
  },
  {
    id: 9,
    year: 2023,
    type: '나형',
    duration: 20,
    fullPrice: '1,560,000',
    grant: '1,092,000',
    actualPrice: '468,000',
  },
];

// ============================================================================
// EFORMSIGN DOC (Electronic Document)
// ============================================================================

export type EformsignStatusType = '060' | '050' | '080'; // pending, completed, expired
export type EformsignStepType = '05' | '06'; // participant, reviewer

export interface EformsignDoc {
  id: number;
  branchId: string | null;
  documentId: string;
  clientId: number;
  createdDate: string;
  updatedDate: string;
  statusType: EformsignStatusType;
  statusDetail: string;
  stepType: EformsignStepType;
  stepIndex: string;
  stepName: string;
  stepRecipientType: string;
  stepRecipientName: string;
  stepRecipientSms: string;
  expiredDate: string;
  expired: boolean;
}

export const mockEformsignDocs: EformsignDoc[] = [
  {
    id: 1,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    documentId: 'edoc_12345678',
    clientId: 1,
    createdDate: '2024-07-25T09:00:00.000Z',
    updatedDate: '2024-08-01T10:30:00.000Z',
    statusType: '050',
    statusDetail: '완료',
    stepType: '06',
    stepIndex: '2',
    stepName: '최종 검토',
    stepRecipientType: 'admin',
    stepRecipientName: '김관리',
    stepRecipientSms: '010-1234-5678',
    expiredDate: '2024-08-25T23:59:59.000Z',
    expired: false,
  },
  {
    id: 2,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    documentId: 'edoc_23456789',
    clientId: 2,
    createdDate: '2024-07-10T14:00:00.000Z',
    updatedDate: '2024-07-15T16:45:00.000Z',
    statusType: '050',
    statusDetail: '완료',
    stepType: '06',
    stepIndex: '2',
    stepName: '최종 검토',
    stepRecipientType: 'admin',
    stepRecipientName: '김관리',
    stepRecipientSms: '010-1234-5678',
    expiredDate: '2024-08-10T23:59:59.000Z',
    expired: false,
  },
  {
    id: 3,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    documentId: 'edoc_34567890',
    clientId: 4,
    createdDate: '2024-04-25T11:00:00.000Z',
    updatedDate: '2024-05-01T09:30:00.000Z',
    statusType: '050',
    statusDetail: '완료',
    stepType: '06',
    stepIndex: '2',
    stepName: '최종 검토',
    stepRecipientType: 'admin',
    stepRecipientName: '김관리',
    stepRecipientSms: '010-1234-5678',
    expiredDate: '2024-05-25T23:59:59.000Z',
    expired: false,
  },
  {
    id: 4,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    documentId: 'edoc_45678901',
    clientId: 5,
    createdDate: '2024-05-28T10:00:00.000Z',
    updatedDate: '2024-06-01T14:20:00.000Z',
    statusType: '050',
    statusDetail: '완료',
    stepType: '06',
    stepIndex: '2',
    stepName: '최종 검토',
    stepRecipientType: 'admin',
    stepRecipientName: '김관리',
    stepRecipientSms: '010-1234-5678',
    expiredDate: '2024-06-28T23:59:59.000Z',
    expired: false,
  },
  {
    id: 5,
    branchId: 'org_01HWXYZ1234567890BCDEFG',
    documentId: 'edoc_56789012',
    clientId: 6,
    createdDate: '2024-08-10T09:00:00.000Z',
    updatedDate: '2024-08-10T09:00:00.000Z',
    statusType: '060',
    statusDetail: '대기',
    stepType: '05',
    stepIndex: '1',
    stepName: '수급자 서명',
    stepRecipientType: 'client',
    stepRecipientName: '최동훈',
    stepRecipientSms: '010-6789-0123',
    expiredDate: '2024-09-10T23:59:59.000Z',
    expired: false,
  },
  {
    id: 6,
    branchId: 'org_01HWXYZ1234567890ABCDEF',
    documentId: 'edoc_67890123',
    clientId: 3,
    createdDate: '2024-08-20T15:00:00.000Z',
    updatedDate: '2024-08-25T10:00:00.000Z',
    statusType: '080',
    statusDetail: '거부',
    stepType: '05',
    stepIndex: '1',
    stepName: '수급자 서명',
    stepRecipientType: 'client',
    stepRecipientName: '이철수',
    stepRecipientSms: '010-3456-7890',
    expiredDate: '2024-09-20T23:59:59.000Z',
    expired: false,
  },
];

// ============================================================================
// AI CHAT
// ============================================================================

export interface ChatSession {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatFeedback {
  id: string;
  sessionId: string;
  messageId: string;
  userId: string;
  type: 'thumbs_up' | 'thumbs_down';
  comment: string | null;
  createdAt: string;
}

export const mockChatSessions: ChatSession[] = [
  {
    id: 'chat_01HWXYZ001',
    userId: 'user_01HWXYZ1234567890ADMIN1',
    createdAt: '2024-09-01T09:00:00.000Z',
    updatedAt: '2024-09-01T09:45:00.000Z',
    expiresAt: '2024-09-02T09:00:00.000Z',
  },
  {
    id: 'chat_01HWXYZ002',
    userId: 'user_01HWXYZ1234567890MNGR01',
    createdAt: '2024-08-30T14:00:00.000Z',
    updatedAt: '2024-08-30T14:30:00.000Z',
    expiresAt: '2024-08-31T14:00:00.000Z',
  },
];

export const mockChatMessages: ChatMessage[] = [
  {
    id: 'msg_001',
    sessionId: 'chat_01HWXYZ001',
    role: 'system',
    content: '안녕하세요! 이미래 인천 돌봄 서비스 AI 어시스턴트입니다. 무엇을 도와드릴까요?',
    timestamp: '2024-09-01T09:00:00.000Z',
  },
  {
    id: 'msg_002',
    sessionId: 'chat_01HWXYZ001',
    role: 'user',
    content: '이번 달 서비스 종료 예정인 수급자 명단을 알려줘',
    timestamp: '2024-09-01T09:01:00.000Z',
  },
  {
    id: 'msg_003',
    sessionId: 'chat_01HWXYZ001',
    role: 'assistant',
    content:
      '이번 달(9월) 서비스 종료 예정인 수급자 목록입니다:\n\n1. 김영희님 - 종료일: 9월 15일\n2. 최동훈님 - 종료일: 10월 15일 (연장 검토 필요)\n\n추가 정보가 필요하시면 말씀해주세요.',
    timestamp: '2024-09-01T09:01:30.000Z',
  },
  {
    id: 'msg_004',
    sessionId: 'chat_01HWXYZ001',
    role: 'user',
    content: '김영희 수급자의 서비스 연장 가능한지 확인해줘',
    timestamp: '2024-09-01T09:02:00.000Z',
  },
  {
    id: 'msg_005',
    sessionId: 'chat_01HWXYZ001',
    role: 'assistant',
    content:
      '김영희님의 서비스 연장 가능 여부를 확인했습니다:\n\n- 현재 서비스 유형: 나형 (15시간)\n- 바우처 잔여 기간: 연장 가능\n- 담당 제공인력(송미라): 연장 가능\n- 수급자 의향: 확인 필요\n\n서비스 연장을 위해 수급자 의향 확인이 필요합니다. 연락을 도와드릴까요?',
    timestamp: '2024-09-01T09:02:45.000Z',
  },
];

export const mockChatFeedbacks: ChatFeedback[] = [
  {
    id: 'fb_001',
    sessionId: 'chat_01HWXYZ001',
    messageId: 'msg_003',
    userId: 'user_01HWXYZ1234567890ADMIN1',
    type: 'thumbs_up',
    comment: '정확한 정보 감사합니다',
    createdAt: '2024-09-01T09:02:00.000Z',
  },
];

// ============================================================================
// SYSTEM SETTINGS
// ============================================================================

export interface SystemSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export const mockSystemSettings: SystemSetting[] = [
  {
    key: 'default_service_duration',
    value: '20',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    key: 'notification_enabled',
    value: 'true',
    updatedAt: '2024-03-15T10:00:00.000Z',
  },
  {
    key: 'ai_chat_enabled',
    value: 'true',
    updatedAt: '2024-07-01T00:00:00.000Z',
  },
];

// ============================================================================
// PUSH SUBSCRIPTION
// ============================================================================

export interface PushSubscription {
  id: number;
  userId: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  userAgent: string | null;
  createdAt: string;
}

export const mockPushSubscriptions: PushSubscription[] = [
  {
    id: 1,
    userId: 'user_01HWXYZ1234567890ADMIN1',
    endpoint:
      'https://fcm.googleapis.com/fcm/send/abcdef123456:APA91bHxxxxxxxx',
    p256dhKey: 'BNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    authKey: 'xxxxxxxxxxxxxxxxxxxxxx',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    createdAt: '2024-06-01T10:00:00.000Z',
  },
  {
    id: 2,
    userId: 'user_01HWXYZ1234567890MNGR01',
    endpoint:
      'https://fcm.googleapis.com/fcm/send/ghijkl789012:APA91bHyyyyyyyy',
    p256dhKey: 'BNyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    authKey: 'yyyyyyyyyyyyyyyyyyyyyy',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    createdAt: '2024-07-15T14:30:00.000Z',
  },
];

// ============================================================================
// AREA TEMPLATE (eFormsign Template Mapping)
// ============================================================================

export interface AreaTemplate {
  id: string;
  areaId: string;
  templateId: string;
  templateName: string | null;
}

export const mockAreaTemplates: AreaTemplate[] = [
  {
    id: 'at_001',
    areaId: 'area_dong',
    templateId: 'eform_tmpl_001',
    templateName: '동구 서비스 계약서',
  },
  {
    id: 'at_002',
    areaId: 'area_dong',
    templateId: 'eform_tmpl_002',
    templateName: '동구 연장 신청서',
  },
  {
    id: 'at_003',
    areaId: 'area_namdong',
    templateId: 'eform_tmpl_003',
    templateName: '남동구 서비스 계약서',
  },
  {
    id: 'at_004',
    areaId: 'area_jung',
    templateId: 'eform_tmpl_004',
    templateName: '중구 서비스 계약서',
  },
];

// ============================================================================
// PAGINATED RESPONSE HELPER
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function createPaginatedResponse<T>(
  items: T[],
  page: number = 1,
  limit: number = 10
): PaginatedResponse<T> {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const data = items.slice(startIndex, endIndex);

  return {
    data,
    total,
    page,
    limit,
    totalPages,
  };
}

// ============================================================================
// STATISTICS & DASHBOARD DATA
// ============================================================================

export interface DashboardStats {
  clients: {
    total: number;
    active: number;
    waiting: number;
    completed: number;
    terminated: number;
    replacementRequested: number;
  };
  employees: {
    total: number;
    available: number;
    working: number;
    unavailable: number;
  };
  schedules: {
    activeThisMonth: number;
    endingThisMonth: number;
    startingNextMonth: number;
  };
  documents: {
    pendingSignatures: number;
    completedThisMonth: number;
    expiringSoon: number;
  };
}

export const mockDashboardStats: DashboardStats = {
  clients: {
    total: 7,
    active: 2,
    waiting: 1,
    completed: 1,
    terminated: 2,
    replacementRequested: 1,
  },
  employees: {
    total: 7,
    available: 3,
    working: 3,
    unavailable: 1,
  },
  schedules: {
    activeThisMonth: 3,
    endingThisMonth: 2,
    startingNextMonth: 1,
  },
  documents: {
    pendingSignatures: 2,
    completedThisMonth: 4,
    expiringSoon: 1,
  },
};

// ============================================================================
// EXPORT ALL
// ============================================================================

export const mockData = {
  branches: mockBranches,
  users: mockUsers,
  userBranches: mockUserBranches,
  clients: mockClients,
  employees: mockEmployees,
  employeeSchedules: mockEmployeeSchedules,
  areas: mockAreas,
  bankAccountInfos: mockBankAccountInfos,
  messages: mockMessages,
  messageTemplates: mockMessageTemplates,
  systemTemplates: mockSystemTemplates,
  notifications: mockNotifications,
  documentCategories: mockDocumentCategories,
  documents: mockDocuments,
  voucherPriceInfos: mockVoucherPriceInfos,
  eformsignDocs: mockEformsignDocs,
  chatSessions: mockChatSessions,
  chatMessages: mockChatMessages,
  chatFeedbacks: mockChatFeedbacks,
  systemSettings: mockSystemSettings,
  pushSubscriptions: mockPushSubscriptions,
  areaTemplates: mockAreaTemplates,
  dashboardStats: mockDashboardStats,
};

export default mockData;
