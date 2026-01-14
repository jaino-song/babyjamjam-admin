import { t, Locale } from '@/app/lib/i18n/translations';

/**
 * Backend Prisma error response structure
 * (No user-facing message - frontend handles localization)
 */
interface PrismaErrorResponse {
    statusCode: number;
    code: string;      // Prisma error code (P2002, P2003, etc.)
    error: string;     // HTTP error type (Conflict, Bad Request, etc.)
    field?: string;    // Affected field name
}

/**
 * Extract error response from Axios error or any error object
 */
export function extractApiError(error: unknown): unknown {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const axiosError = error as {
        response?: { data?: unknown };
        data?: unknown;
    };

    // Axios error structure: error.response.data
    if (axiosError.response?.data) {
        return axiosError.response.data;
    }

    // Direct data property (from TanStack Query error)
    if (axiosError.data) {
        return axiosError.data;
    }

    // If error itself has code property, it might be the error response
    if ('code' in error) {
        return error;
    }

    return null;
}

/**
 * Type guard to check if error is a Prisma error response
 */
function isPrismaErrorResponse(error: unknown): error is PrismaErrorResponse {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as PrismaErrorResponse).code === 'string' &&
        (error as PrismaErrorResponse).code.startsWith('P')
    );
}

/**
 * Map Prisma error code to user-friendly message using i18n
 *
 * @param error - The extracted API error object
 * @param locale - Current locale ('ko' | 'en')
 * @returns User-friendly error message, or null if not a Prisma error
 *
 * @example
 * const apiError = extractApiError(error);
 * const message = mapPrismaError(apiError, locale) || t(locale, 'errors.generic');
 */
export function mapPrismaError(error: unknown, locale: Locale): string | null {
    if (!isPrismaErrorResponse(error)) {
        return null;
    }

    const { code, field } = error;

    // Try field-specific translation first (e.g., errors.prisma.P2002.phone)
    if (field) {
        const fieldSpecificKey = `errors.prisma.${code}.${field}`;
        const fieldSpecificMsg = t(locale, fieldSpecificKey);
        if (fieldSpecificMsg !== fieldSpecificKey) {
            return fieldSpecificMsg;
        }
    }

    // Fall back to generic error with field interpolation
    const baseKey = `errors.prisma.${code}`;
    let message = t(locale, baseKey);

    // If key not found, use unknown error message
    if (message === baseKey) {
        return t(locale, 'errors.prisma.unknown');
    }

    // Interpolate field name if present
    if (field && message.includes('{field}')) {
        const fieldLabelKey = `errors.fields.${field}`;
        const fieldLabel = t(locale, fieldLabelKey);
        // Use translated field name if available, otherwise use raw field name
        const displayField = fieldLabel !== fieldLabelKey ? fieldLabel : field;
        message = message.replace('{field}', displayField);
    }

    return message;
}

/**
 * Get error message from any error type, with Prisma error handling
 * Falls back to generic error message if not a Prisma error
 */
export function getErrorMessage(
    error: unknown,
    locale: Locale,
    fallbackKey: string = 'errors.generic'
): string {
    const apiError = extractApiError(error);
    return mapPrismaError(apiError, locale) || t(locale, fallbackKey);
}
