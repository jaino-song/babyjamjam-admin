import createMiddleware from "next-intl/middleware";

export default createMiddleware({
    locales: ["en", "ko"],
    defaultLocale: "ko",
    localeDetection: true,
    localePrefix: "as-needed",
})

export const config = {
    matcher: ['/', '/(ko|en)/:path*']
};