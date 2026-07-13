/**
 * Mock Data Module
 *
 * Centralized exports for all mock data used in frontend development.
 *
 * Usage Examples:
 *
 * 1. Import specific mock data:
 *    import { mockClients, mockEmployees } from '@/mocks'
 *
 * 2. Import all mock data:
 *    import { mockData } from '@/mocks'
 *
 * 3. Use pagination helper:
 *    import { createPaginatedResponse, mockClients } from '@/mocks'
 *    const paginatedClients = createPaginatedResponse(mockClients, 1, 10)
 *
 * 4. Use mock API handlers:
 *    import { mockApiHandlers } from '@/mocks'
 *    const clients = mockApiHandlers.clients.getAll({ page: 1, limit: 10 })
 */

// Re-export everything from mock-data
export * from './mock-data';
export { default as mockData } from './mock-data';

// Re-export handlers
export * from './handlers';
