/**
 * Mock API Handlers
 *
 * Utility functions to simulate API responses during frontend development.
 * These handlers mimic the actual API behavior including filtering, pagination, and delays.
 */

import {
  mockClients,
  mockEmployees,
  mockEmployeeSchedules,
  mockMessages,
  mockMessageTemplates,
  mockNotifications,
  mockDocuments,
  mockDocumentCategories,
  mockOrganizations,
  mockUsers,
  mockVoucherPriceInfos,
  mockEformsignDocs,
  mockChatSessions,
  mockChatMessages,
  mockAreas,
  mockBankAccountInfos,
  mockSystemSettings,
  mockAreaTemplates,
  mockDashboardStats,
  createPaginatedResponse,
  type Client,
  type Employee,
  type EmployeeSchedule,
  type ServiceStatus,
  type PaginatedResponse,
} from './mock-data';

// ============================================================================
// TYPES
// ============================================================================

interface BaseQueryParams {
  page?: number;
  limit?: number;
  organizationId?: string;
}

interface ClientQueryParams extends BaseQueryParams {
  serviceStatus?: ServiceStatus;
  voucherClient?: boolean;
  careCenter?: boolean;
  search?: string;
}

interface EmployeeQueryParams extends BaseQueryParams {
  status?: 'available' | 'working' | 'unavailable';
  openToNextWork?: boolean;
  workArea?: string;
  search?: string;
}

interface ScheduleQueryParams extends BaseQueryParams {
  clientId?: number;
  employeeId?: number;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simulates network delay for more realistic mock behavior
 */
export async function simulateDelay(ms: number = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Filters items by organization ID (multi-tenancy support)
 */
function filterByOrganization<T extends { organizationId: string | null }>(
  items: T[],
  organizationId?: string
): T[] {
  if (!organizationId) return items;
  return items.filter(
    (item) => item.organizationId === organizationId || item.organizationId === null
  );
}

// ============================================================================
// CLIENT HANDLERS
// ============================================================================

export const clientHandlers = {
  getAll: (params: ClientQueryParams = {}): PaginatedResponse<Client> => {
    const { page = 1, limit = 10, organizationId, serviceStatus, voucherClient, careCenter, search } = params;

    let filtered = filterByOrganization(mockClients, organizationId);

    if (serviceStatus) {
      filtered = filtered.filter((c) => c.serviceStatus === serviceStatus);
    }

    if (typeof voucherClient === 'boolean') {
      filtered = filtered.filter((c) => c.voucherClient === voucherClient);
    }

    if (typeof careCenter === 'boolean') {
      filtered = filtered.filter((c) => c.careCenter === careCenter);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(searchLower) ||
          c.phone?.includes(search) ||
          c.address?.toLowerCase().includes(searchLower)
      );
    }

    return createPaginatedResponse(filtered, page, limit);
  },

  getById: (id: number): Client | undefined => {
    return mockClients.find((c) => c.id === id);
  },

  getStats: (organizationId?: string) => {
    const filtered = filterByOrganization(mockClients, organizationId);
    return {
      total: filtered.length,
      active: filtered.filter((c) => c.serviceStatus === 'active').length,
      pending: filtered.filter((c) => c.serviceStatus === 'pending').length,
      completed: filtered.filter((c) => c.serviceStatus === 'completed').length,
      terminated: filtered.filter((c) => c.serviceStatus === 'terminated').length,
      replacementRequested: filtered.filter((c) => c.serviceStatus === 'replacement_requested').length,
      inactive: filtered.filter((c) => c.serviceStatus === 'inactive').length,
    };
  },
};

// ============================================================================
// EMPLOYEE HANDLERS
// ============================================================================

export const employeeHandlers = {
  getAll: (params: EmployeeQueryParams = {}): PaginatedResponse<Employee> => {
    const { page = 1, limit = 10, organizationId, status, openToNextWork, workArea, search } = params;

    let filtered = filterByOrganization(mockEmployees, organizationId);

    if (status) {
      filtered = filtered.filter((e) => e.status === status);
    }

    if (typeof openToNextWork === 'boolean') {
      filtered = filtered.filter((e) => e.openToNextWork === openToNextWork);
    }

    if (workArea) {
      filtered = filtered.filter((e) => e.workArea.includes(workArea));
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(searchLower) ||
          e.phone.includes(search)
      );
    }

    return createPaginatedResponse(filtered, page, limit);
  },

  getById: (id: number): Employee | undefined => {
    return mockEmployees.find((e) => e.id === id);
  },

  getAvailable: (organizationId?: string): Employee[] => {
    return filterByOrganization(mockEmployees, organizationId).filter(
      (e) => e.status === 'available' && e.openToNextWork
    );
  },
};

// ============================================================================
// SCHEDULE HANDLERS
// ============================================================================

export const scheduleHandlers = {
  getAll: (params: ScheduleQueryParams = {}): PaginatedResponse<EmployeeSchedule> => {
    const { page = 1, limit = 10, organizationId, clientId, employeeId, startDate, endDate } = params;

    let filtered = filterByOrganization(mockEmployeeSchedules, organizationId);

    if (clientId) {
      filtered = filtered.filter((s) => s.clientId === clientId);
    }

    if (employeeId) {
      filtered = filtered.filter(
        (s) => s.primaryEmployeeId === employeeId || s.secondaryEmployeeId === employeeId
      );
    }

    if (startDate) {
      filtered = filtered.filter((s) => new Date(s.startDate) >= new Date(startDate));
    }

    if (endDate) {
      filtered = filtered.filter((s) => new Date(s.endDate) <= new Date(endDate));
    }

    return createPaginatedResponse(filtered, page, limit);
  },

  getByClientId: (clientId: number): EmployeeSchedule[] => {
    return mockEmployeeSchedules.filter((s) => s.clientId === clientId);
  },

  getByEmployeeId: (employeeId: number): EmployeeSchedule[] => {
    return mockEmployeeSchedules.filter(
      (s) => s.primaryEmployeeId === employeeId || s.secondaryEmployeeId === employeeId
    );
  },
};

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

export const messageHandlers = {
  getAll: (params: BaseQueryParams = {}) => {
    const { page = 1, limit = 10, organizationId } = params;
    const filtered = filterByOrganization(mockMessages, organizationId);
    return createPaginatedResponse(filtered, page, limit);
  },

  getById: (id: number) => {
    return mockMessages.find((m) => m.id === id);
  },
};

// ============================================================================
// MESSAGE TEMPLATE HANDLERS
// ============================================================================

export const messageTemplateHandlers = {
  getAll: (params: BaseQueryParams = {}) => {
    const { page = 1, limit = 10, organizationId } = params;
    let filtered = mockMessageTemplates;
    if (organizationId) {
      filtered = filtered.filter(
        (t) => t.organizationId === organizationId || t.organizationId === null
      );
    }
    return createPaginatedResponse(filtered, page, limit);
  },

  getById: (id: string) => {
    return mockMessageTemplates.find((t) => t.id === id);
  },
};

// ============================================================================
// NOTIFICATION HANDLERS
// ============================================================================

export const notificationHandlers = {
  getByUserId: (userId: string, includeRead: boolean = false) => {
    let filtered = mockNotifications.filter((n) => n.userId === userId);
    if (!includeRead) {
      filtered = filtered.filter((n) => n.readAt === null);
    }
    return filtered.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  },

  getUnreadCount: (userId: string) => {
    return mockNotifications.filter((n) => n.userId === userId && n.readAt === null).length;
  },
};

// ============================================================================
// DOCUMENT HANDLERS
// ============================================================================

export const documentHandlers = {
  getAll: (params: BaseQueryParams & { categoryId?: string; search?: string } = {}) => {
    const { page = 1, limit = 10, organizationId, categoryId, search } = params;

    let filtered = filterByOrganization(mockDocuments, organizationId);

    if (categoryId) {
      filtered = filtered.filter((d) => d.categoryId === categoryId);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(searchLower) ||
          d.description?.toLowerCase().includes(searchLower) ||
          d.tags.some((t) => t.toLowerCase().includes(searchLower))
      );
    }

    return createPaginatedResponse(filtered, page, limit);
  },

  getById: (id: string) => {
    return mockDocuments.find((d) => d.id === id);
  },

  getCategories: (organizationId?: string) => {
    if (!organizationId) return mockDocumentCategories;
    return mockDocumentCategories.filter(
      (c) => c.organizationId === organizationId || c.organizationId === null
    );
  },
};

// ============================================================================
// EFORMSIGN HANDLERS
// ============================================================================

export const eformsignHandlers = {
  getAll: (params: BaseQueryParams & { statusType?: string; clientId?: number } = {}) => {
    const { page = 1, limit = 10, organizationId, statusType, clientId } = params;

    let filtered = filterByOrganization(mockEformsignDocs, organizationId);

    if (statusType) {
      filtered = filtered.filter((d) => d.statusType === statusType);
    }

    if (clientId) {
      filtered = filtered.filter((d) => d.clientId === clientId);
    }

    return createPaginatedResponse(filtered, page, limit);
  },

  getByDocumentId: (documentId: string) => {
    return mockEformsignDocs.find((d) => d.documentId === documentId);
  },

  getPendingCount: (organizationId?: string) => {
    const filtered = filterByOrganization(mockEformsignDocs, organizationId);
    return filtered.filter((d) => d.statusType === '060').length;
  },
};

// ============================================================================
// VOUCHER PRICE HANDLERS
// ============================================================================

export const voucherPriceHandlers = {
  getByYear: (year: number) => {
    return mockVoucherPriceInfos.filter((v) => v.year === year);
  },

  getByYearAndType: (year: number, type: string) => {
    return mockVoucherPriceInfos.filter((v) => v.year === year && v.type === type);
  },

  getAvailableYears: () => {
    const years = [...new Set(mockVoucherPriceInfos.map((v) => v.year))];
    return years.sort((a, b) => b - a);
  },
};

// ============================================================================
// ORGANIZATION HANDLERS
// ============================================================================

export const organizationHandlers = {
  getAll: () => mockOrganizations,

  getById: (id: string) => {
    return mockOrganizations.find((o) => o.id === id);
  },

  getBySlug: (slug: string) => {
    return mockOrganizations.find((o) => o.slug === slug);
  },

  getActive: () => {
    return mockOrganizations.filter((o) => o.isActive);
  },
};

// ============================================================================
// USER HANDLERS
// ============================================================================

export const userHandlers = {
  getById: (id: string) => {
    return mockUsers.find((u) => u.id === id);
  },

  getByKakaoId: (kakaoId: string) => {
    return mockUsers.find((u) => u.kakaoId === kakaoId);
  },
};

// ============================================================================
// AREA HANDLERS
// ============================================================================

export const areaHandlers = {
  getAll: (organizationId?: string) => {
    if (!organizationId) return mockAreas;
    return mockAreas.filter((a) => a.organizationId === organizationId || a.organizationId === null);
  },

  getById: (id: string) => {
    return mockAreas.find((a) => a.id === id);
  },

  getBankAccountInfo: (areaId: string) => {
    return mockBankAccountInfos.find((b) => b.areaId === areaId);
  },

  getTemplates: (areaId: string) => {
    return mockAreaTemplates.filter((t) => t.areaId === areaId);
  },
};

// ============================================================================
// CHAT HANDLERS
// ============================================================================

export const chatHandlers = {
  getSessions: (userId: string) => {
    return mockChatSessions.filter((s) => s.userId === userId);
  },

  getMessages: (sessionId: string) => {
    return mockChatMessages.filter((m) => m.sessionId === sessionId);
  },
};

// ============================================================================
// SETTINGS HANDLERS
// ============================================================================

export const settingsHandlers = {
  getAll: () => mockSystemSettings,

  getByKey: (key: string) => {
    return mockSystemSettings.find((s) => s.key === key);
  },
};

// ============================================================================
// DASHBOARD HANDLERS
// ============================================================================

export const dashboardHandlers = {
  getStats: () => mockDashboardStats,
};

// ============================================================================
// EXPORT ALL HANDLERS
// ============================================================================

export const mockApiHandlers = {
  clients: clientHandlers,
  employees: employeeHandlers,
  schedules: scheduleHandlers,
  messages: messageHandlers,
  messageTemplates: messageTemplateHandlers,
  notifications: notificationHandlers,
  documents: documentHandlers,
  eformsign: eformsignHandlers,
  voucherPrices: voucherPriceHandlers,
  organizations: organizationHandlers,
  users: userHandlers,
  areas: areaHandlers,
  chat: chatHandlers,
  settings: settingsHandlers,
  dashboard: dashboardHandlers,
  // Utility
  simulateDelay,
};

export default mockApiHandlers;
