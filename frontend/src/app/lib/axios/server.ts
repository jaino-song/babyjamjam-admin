import axios from "axios";
import { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const API_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    timeout: 60000, // 60 seconds - Railway apps can take time to wake up
    validateStatus: (status) => status < 600, // Accept any status code for better error visibility
});
