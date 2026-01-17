import { parseNotificationUrl } from '../NotificationBell';

describe('parseNotificationUrl', () => {
    describe('given a filtered clients URL with /filtered path', () => {
        it.each([
            ['starting-soon', '/clients/filtered?filter=starting-soon'],
            ['ending-soon', '/clients/filtered?filter=ending-soon'],
            ['incomplete-contracts', '/clients/filtered?filter=incomplete-contracts'],
            ['no-contract', '/clients/filtered?filter=no-contract'],
        ])('should parse filter type "%s" from URL', (expectedFilter, url) => {
            const result = parseNotificationUrl(url);

            expect(result).toEqual({
                type: 'filter',
                filterType: expectedFilter,
            });
        });
    });

    describe('given a filtered clients URL without /filtered path (legacy format)', () => {
        it.each([
            ['starting-soon', '/clients?filter=starting-soon'],
            ['ending-soon', '/clients?filter=ending-soon'],
            ['incomplete-contracts', '/clients?filter=incomplete-contracts'],
            ['no-contract', '/clients?filter=no-contract'],
        ])('should parse filter type "%s" from URL', (expectedFilter, url) => {
            const result = parseNotificationUrl(url);

            expect(result).toEqual({
                type: 'filter',
                filterType: expectedFilter,
            });
        });
    });

    describe('given an individual client URL', () => {
        it('should parse client ID from URL', () => {
            const result = parseNotificationUrl('/clients?id=123');

            expect(result).toEqual({
                type: 'client',
                clientId: 123,
            });
        });

        it('should handle different client IDs', () => {
            const result = parseNotificationUrl('/clients?id=456');

            expect(result).toEqual({
                type: 'client',
                clientId: 456,
            });
        });
    });

    describe('given a non-filtered URL', () => {
        it.each([
            '/clients/123',
            '/employees/456',
            '/dashboard',
            '/clients',
            '/clients/filtered',
            '/some/other/path',
        ])('should return null for URL "%s"', (url) => {
            const result = parseNotificationUrl(url);

            expect(result).toBeNull();
        });
    });
});
