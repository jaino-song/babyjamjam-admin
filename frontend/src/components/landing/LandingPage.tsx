"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/translations";

interface LandingPageProps {
    locale: Locale;
}

/* ─── Scroll Progress Bar ─── */
function ProgressBar() {
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const onScroll = () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
            setWidth(pct);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <div
            className="fixed top-0 left-0 h-[3px] z-[9999] transition-[width] duration-100"
            style={{
                width: `${width}%`,
                background: "linear-gradient(90deg, #12366a, #06b6d4)",
            }}
        />
    );
}

/* ─── Scroll Reveal Hook ─── */
function useScrollReveal<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.unobserve(el);
                }
            },
            { threshold: 0.15, rootMargin: "0px 0px -50px 0px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return { ref, visible };
}

/* ─── Reveal Wrapper ─── */
function Reveal({
    children,
    delay = 0,
    className = "",
}: {
    children: React.ReactNode;
    delay?: number;
    className?: string;
}) {
    const { ref, visible } = useScrollReveal<HTMLDivElement>();

    return (
        <div
            ref={ref}
            className={`transition-all duration-700 ease-out ${className}`}
            style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(40px)",
                transitionDelay: `${delay}ms`,
            }}
        >
            {children}
        </div>
    );
}

/* ─── Mock Client Row ─── */
function MockClientRow({
    initial,
    name,
    detail,
    status,
    statusClass,
}: {
    initial: string;
    name: string;
    detail: string;
    status: string;
    statusClass: string;
}) {
    return (
        <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 hover:bg-sky-50 hover:translate-x-2 transition-all duration-300 cursor-default group">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 bg-gradient-to-br from-[#12366a] to-[#06b6d4]">
                {initial}
            </div>
            <div className="flex-1 text-left">
                <h4 className="text-sm font-semibold text-slate-900">{name}</h4>
                <p className="text-xs text-slate-500">{detail}</p>
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full shrink-0 ${statusClass}`}>{status}</span>
        </div>
    );
}

/* ─── Mock Message Bubble ─── */
function MockMessageBubble({ sent = false, children }: { sent?: boolean; children: React.ReactNode }) {
    return (
        <div
            className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed transition-all duration-300 ${
                sent
                    ? "bg-gradient-to-br from-[#12366a] to-[#1a4a8f] text-white ml-auto rounded-tr-sm"
                    : "bg-slate-100 text-slate-800 rounded-tl-sm"
            }`}
        >
            {children}
        </div>
    );
}

/* ─── Mock Contract Step ─── */
function MockContractStep({
    icon,
    title,
    subtitle,
    state,
}: {
    icon: string;
    title: string;
    subtitle: string;
    state: "done" | "active" | "pending";
}) {
    const stateClasses = {
        done: "border-emerald-400 bg-emerald-50 opacity-70",
        active: "border-[#12366a] bg-sky-50",
        pending: "border-slate-200 bg-white",
    };

    const iconClasses = {
        done: "bg-emerald-400 text-white",
        active: "bg-[#12366a] text-white",
        pending: "bg-slate-200 text-slate-500",
    };

    return (
        <div
            className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-300 hover:border-slate-400 ${stateClasses[state]}`}
        >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${iconClasses[state]}`}>
                {icon}
            </div>
            <div className="text-left">
                <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
                <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
        </div>
    );
}

/* ─── Main Landing Page ─── */
export default function LandingPage({ locale }: LandingPageProps) {
    const isKo = locale === "ko";
    const translate = (key: string) => t(locale, key);

    /* Scroll-to smooth handler */
    const handleAnchor = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
        if (href.startsWith("#")) {
            e.preventDefault();
            const el = document.querySelector(href);
            if (el) el.scrollIntoView({ behavior: "smooth" });
        }
    };

    return (
        <div className="relative">
            <ProgressBar />

            {/* ─── Navbar ─── */}
            <nav className="fixed top-0 left-0 right-0 z-[1000] bg-white/90 backdrop-blur-xl border-b border-slate-200">
                <div className="max-w-[1200px] mx-auto px-6 flex justify-between items-center h-[70px]">
                    <Link href="/" className="flex items-center gap-2 text-xl font-extrabold text-[#12366a] tracking-tight">
                        <img src="/babyjamjam-logo.svg" alt="" className="h-8 w-8" />
                        {translate("landing.nav_brand")}
                    </Link>
                    <div className="hidden md:flex items-center gap-8">
                        <a href="#problem" onClick={(e) => handleAnchor(e, "#problem")} className="text-sm font-medium text-slate-500 hover:text-[#12366a] transition-colors">
                            {translate("landing.nav_problem")}
                        </a>
                        <a href="#solution" onClick={(e) => handleAnchor(e, "#solution")} className="text-sm font-medium text-slate-500 hover:text-[#12366a] transition-colors">
                            {translate("landing.nav_solution")}
                        </a>
                        <a href="#features" onClick={(e) => handleAnchor(e, "#features")} className="text-sm font-medium text-slate-500 hover:text-[#12366a] transition-colors">
                            {translate("landing.nav_features")}
                        </a>
                        <Button asChild className="bg-[#12366a] hover:bg-[#1a4a8f] text-white font-semibold rounded-lg px-5 py-2 text-sm">
                            <Link href="/login">{translate("user.login")}</Link>
                        </Button>
                    </div>
                    {/* Mobile login only */}
                    <div className="md:hidden">
                        <Button asChild className="bg-[#12366a] hover:bg-[#1a4a8f] text-white font-semibold rounded-lg px-4 py-2 text-sm">
                            <Link href="/login">{translate("user.login")}</Link>
                        </Button>
                    </div>
                </div>
            </nav>

            {/* ─── Hero Section ─── */}
            <section className="relative min-h-screen flex items-center justify-center px-6 pt-[70px] bg-gradient-to-br from-sky-50 via-blue-50 to-white">
                <div className="max-w-[1000px] w-full text-center">
                    <Reveal>
                        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.1] tracking-tight mb-8">
                            <span className="bg-gradient-to-r from-[#12366a] to-cyan-500 bg-clip-text text-transparent">
                                {translate("landing.hero_title_line1")}
                                <br />
                                {translate("landing.hero_title_line2")}
                            </span>
                        </h1>
                    </Reveal>
                    <Reveal delay={150}>
                        <p className="text-lg md:text-xl text-slate-500 max-w-[600px] mx-auto mb-10 leading-relaxed">
                            {translate("landing.hero_subtitle")}
                        </p>
                    </Reveal>
                    <Reveal delay={300}>
                        <Button
                            asChild
                            className="bg-[#12366a] hover:bg-[#1a4a8f] text-white font-bold rounded-xl px-10 py-6 text-lg shadow-lg shadow-[#12366a]/20 hover:shadow-xl hover:shadow-[#12366a]/30 hover:-translate-y-0.5 transition-all duration-200"
                        >
                            <Link href="/login">{translate("landing.cta_button")}</Link>
                        </Button>
                    </Reveal>
                </div>

                {/* Scroll Indicator */}
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-slate-400 text-sm animate-bounce">
                    <span>{translate("landing.scroll_hint")}</span>
                    <ChevronDown className="w-6 h-6" />
                </div>
            </section>

            {/* ─── Step 1: Client Management ─── */}
            <section id="problem" className="min-h-screen flex items-center justify-center px-6 py-24 bg-white">
                <div className="max-w-[1000px] w-full text-center">
                    <Reveal>
                        <div className="inline-flex items-center justify-center w-[60px] h-[60px] rounded-full bg-gradient-to-br from-[#12366a] to-cyan-500 text-white text-xl font-extrabold mb-8 shadow-lg shadow-[#12366a]/20">
                            {translate("landing.step1_number")}
                        </div>
                    </Reveal>
                    <Reveal delay={100}>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6">{translate("landing.step1_title")}</h2>
                    </Reveal>
                    <Reveal delay={200}>
                        <p className="text-lg text-slate-500 max-w-[600px] mx-auto mb-12 leading-relaxed">
                            {translate("landing.step1_desc")}
                        </p>
                    </Reveal>
                    <Reveal delay={300}>
                        <div className="max-w-[700px] mx-auto bg-white rounded-[20px] p-6 md:p-8 shadow-xl shadow-slate-200/50 border border-slate-100 text-left">
                            <div className="flex flex-col gap-3">
                                <MockClientRow
                                    initial="김"
                                    name={isKo ? "김지영 산모님" : "Kim Jiyeong"}
                                    detail={isKo ? "서비스 중 · 남동구 · 2025.03.15 시작" : "Active · Namdong-gu · Started 2025.03.15"}
                                    status={translate("landing.mock_status_active")}
                                    statusClass="bg-emerald-100 text-emerald-700"
                                />
                                <MockClientRow
                                    initial="박"
                                    name={isKo ? "박서연 산모님" : "Park Seoyeon"}
                                    detail={isKo ? "상담 완료 · 연수구 · 계약 대기" : "Consulted · Yeonsu-gu · Contract pending"}
                                    status={translate("landing.mock_status_pending")}
                                    statusClass="bg-amber-100 text-amber-700"
                                />
                                <MockClientRow
                                    initial="이"
                                    name={isKo ? "이민정 산모님" : "Lee Minjeong"}
                                    detail={isKo ? "서비스 예정 · 부평구 · 2025.04.01 시작" : "Scheduled · Bupyeong-gu · Starts 2025.04.01"}
                                    status={translate("landing.mock_status_scheduled")}
                                    statusClass="bg-sky-100 text-sky-700"
                                />
                            </div>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* ─── Step 2: Template Messages ─── */}
            <section id="solution" className="min-h-screen flex items-center justify-center px-6 py-24 bg-slate-50">
                <div className="max-w-[1000px] w-full text-center">
                    <Reveal>
                        <div className="inline-flex items-center justify-center w-[60px] h-[60px] rounded-full bg-gradient-to-br from-[#12366a] to-cyan-500 text-white text-xl font-extrabold mb-8 shadow-lg shadow-[#12366a]/20">
                            {translate("landing.step2_number")}
                        </div>
                    </Reveal>
                    <Reveal delay={100}>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6">{translate("landing.step2_title")}</h2>
                    </Reveal>
                    <Reveal delay={200}>
                        <p className="text-lg text-slate-500 max-w-[600px] mx-auto mb-12 leading-relaxed">
                            {translate("landing.step2_desc")}
                        </p>
                    </Reveal>
                    <Reveal delay={300}>
                        <div className="max-w-[700px] mx-auto bg-white rounded-[20px] p-6 md:p-8 shadow-xl shadow-slate-200/50 border border-slate-100">
                            <div className="flex flex-col gap-4">
                                <MockMessageBubble>
                                    {isKo ? (
                                        <>
                                            안녕하세요, 아가잼잼입니다.<br />
                                            {"{{산모님성함}}"}님의 서비스 시작일은 {"{{시작일}}"}입니다.
                                        </>
                                    ) : (
                                        <>
                                            Hello, this is BabyJamJam.<br />
                                            {"{{MotherName}}"}&apos;s service start date is {"{{StartDate}}"}.
                                        </>
                                    )}
                                </MockMessageBubble>
                                <MockMessageBubble sent>
                                    {isKo ? (
                                        <>
                                            안녕하세요, 아가잼잼입니다.<br />
                                            김지영님의 서비스 시작일은 3월 15일입니다.
                                        </>
                                    ) : (
                                        <>
                                            Hello, this is BabyJamJam.<br />
                                            Kim Jiyeong&apos;s service start date is March 15.
                                        </>
                                    )}
                                </MockMessageBubble>
                            </div>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* ─── Step 3: Paperless Contracts ─── */}
            <section id="features" className="min-h-screen flex items-center justify-center px-6 py-24 bg-white">
                <div className="max-w-[1000px] w-full text-center">
                    <Reveal>
                        <div className="inline-flex items-center justify-center w-[60px] h-[60px] rounded-full bg-gradient-to-br from-[#12366a] to-cyan-500 text-white text-xl font-extrabold mb-8 shadow-lg shadow-[#12366a]/20">
                            {translate("landing.step3_number")}
                        </div>
                    </Reveal>
                    <Reveal delay={100}>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6">{translate("landing.step3_title")}</h2>
                    </Reveal>
                    <Reveal delay={200}>
                        <p className="text-lg text-slate-500 max-w-[600px] mx-auto mb-12 leading-relaxed">
                            {translate("landing.step3_desc")}
                        </p>
                    </Reveal>
                    <Reveal delay={300}>
                        <div className="max-w-[700px] mx-auto bg-white rounded-[20px] p-6 md:p-8 shadow-xl shadow-slate-200/50 border border-slate-100">
                            <div className="flex flex-col gap-4">
                                <MockContractStep
                                    icon="✓"
                                    title={translate("landing.mock_contract_step1")}
                                    subtitle={translate("landing.mock_contract_step1_sub")}
                                    state="done"
                                />
                                <MockContractStep
                                    icon="✍️"
                                    title={translate("landing.mock_contract_step2")}
                                    subtitle={translate("landing.mock_contract_step2_sub")}
                                    state="active"
                                />
                                <MockContractStep
                                    icon="📋"
                                    title={translate("landing.mock_contract_step3")}
                                    subtitle={translate("landing.mock_contract_step3_sub")}
                                    state="pending"
                                />
                            </div>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* ─── CTA Section ─── */}
            <section className="min-h-[60vh] flex items-center justify-center px-6 py-24 bg-gradient-to-br from-[#12366a] to-[#0f2a52] text-white text-center">
                <div className="max-w-[700px] w-full">
                    <Reveal>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">{translate("landing.cta_title")}</h2>
                    </Reveal>
                    <Reveal delay={150}>
                        <p className="text-lg text-white/80 mb-10 max-w-[500px] mx-auto leading-relaxed">
                            {translate("landing.cta_subtitle")}
                        </p>
                    </Reveal>
                    <Reveal delay={300}>
                        <Button
                            asChild
                            className="bg-white text-[#12366a] hover:bg-slate-50 font-bold rounded-xl px-10 py-6 text-lg shadow-xl hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200"
                        >
                            <Link href="/login">{translate("landing.cta_button")}</Link>
                        </Button>
                    </Reveal>
                </div>
            </section>

            {/* ─── Footer ─── */}
            <footer className="text-center py-10 text-slate-400 text-sm bg-white border-t border-slate-100">
                {translate("landing.footer")}
            </footer>
        </div>
    );
}
