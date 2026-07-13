import axios from "axios";

import { captureApiError } from "@/lib/observability/capture-api-error";
import { resolveServerApiUrl } from "@/lib/api/server-base-url";

const API_URL = resolveServerApiUrl();

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    proxy: false,
    timeout: 60000,
    validateStatus: (status) => status < 400,
    headers: {
        "Content-Type": "application/json",
    },
});

serverAPIClient.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
        captureApiError(error);
        return Promise.reject(error);
    },
);
