import axios from "axios";

const isProduction = process.env.NODE_ENV === "production";
const API_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

console.log("[Server API Client] Environment:", process.env.NODE_ENV);
console.log("[Server API Client] API URL:", API_URL);

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
});