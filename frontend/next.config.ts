import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    turbopack: {
        root: process.cwd(),
    },
    async rewrites() {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL;
        // Using fallback rewrites ensures Next.js API routes are checked first
        // Fallback rewrites only apply when no matching page/API route exists
        return {
            beforeFiles: [],
            afterFiles: [],
            fallback: [
                {
                    source: '/api/:path*',
                    destination: `${apiUrl}/:path*`,
                },
            ],
        };
    },
};

export default nextConfig;
