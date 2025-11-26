"use client"; 
import { useEffect } from "react";

const API_BASE_URL =
    process.env.RAILWAY_PUBLIC_API_BASE_URL ||
    process.env.DEVELOPMENT_API_BASE_URL;

const LoginPage = () => {
  useEffect(() => {
    window.location.href = `${API_BASE_URL}/auth/kakao`;
  }, []);
}

export default LoginPage