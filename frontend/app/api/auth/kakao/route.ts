import { redirect } from "next/navigation";

const isProduction = process.env.NODE_ENV === "production";
const API_URL = isProduction ? process.env.NEXT_PUBLIC_API_BASE_URL : process.env.DEVELOPMENT_API_BASE_URL;

export async function GET() {
    redirect(`${API_URL}/auth/kakao`);
}