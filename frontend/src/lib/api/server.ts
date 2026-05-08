import axios from "axios";

import { resolveServerApiUrl } from "@/lib/api/server-base-url";

const API_URL = resolveServerApiUrl();

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    proxy: false,
    timeout: 60000,
    validateStatus: (status) => status < 600,
    headers: {
        "Content-Type": "application/json",
    },
});
