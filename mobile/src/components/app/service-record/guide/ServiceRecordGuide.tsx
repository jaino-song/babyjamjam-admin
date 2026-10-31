"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useReducedMotion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { GuideDemoStage } from "./GuideDemoStage";
import { GuideIntroStage } from "./GuideIntroStage";
import { GUIDE_LAST_BUTTON_LABEL, GUIDE_SLIDES, GUIDE_TITLE } from "./guideSlides";
import styles from "./ServiceRecordGuide.module.css";

const SOURCE_COMPONENT = "ServiceRecordGuide";
const SLIDE_COUNT = GUIDE_SLIDES.length;
const LAST_INDEX = SLIDE_COUNT - 1;
/** A horizontal drag longer than this (px) turns the page. */
const SWIPE_THRESHOLD_PX = 50;

const clampIndex = (index: number): number => Math.max(0, Math.min(LAST_INDEX, index));

export interface ServiceRecordGuideProps {
    /** The caller's full path (`…_guide`); every node below derives from it. */
    "data-component": string;
    open: boolean;
    /** 건너뛰기, the last slide's button and Esc all land here. */
    onClose: () => void;
}

interface GuidePanelProps {
    sheet: string;
    open: boolean;
    onClose: () => void;
    nextRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Seven-slide, animated how-to for the caregiver service-record flow. It is a modal bottom sheet over
 * the current step: progress bars, `n / 7`, 건너뛰기, swipe / arrow-key paging and 이전 / 다음. Six slides
 * carry a looping demo of the real screens (see `guideDemos`); under reduced motion they show a still.
 * The content mounts only while open, so each opening starts on slide 1.
 */
export function ServiceRecordGuide({ "data-component": base, open, onClose }: ServiceRecordGuideProps) {
    const nextRef = useRef<HTMLButtonElement>(null);
    // Radix restores focus only to a trigger it knows; this sheet is opened from outside, so keep the opener here.
    const openerRef = useRef<Element | null>(null);
    const sheet = `${base}_sheet`;

    return (
        <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <SheetContent
                side="bottom"
                data-component={sheet}
                data-source-component={SOURCE_COMPONENT}
                className={styles.sheet}
                aria-modal="true"
                aria-describedby={undefined}
                // Only 건너뛰기, the last button and Esc close it: a stray tap on the dim must not dismiss it for good.
                onInteractOutside={(event) => event.preventDefault()}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    // Focus has not moved yet: the active element is whatever opened the guide (<body> when it opened by itself).
                    openerRef.current = document.activeElement;
                    nextRef.current?.focus();
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    const opener = openerRef.current;
                    openerRef.current = null;
                    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
                }}
            >
                <SheetTitle className="sr-only">{GUIDE_TITLE}</SheetTitle>
                <GuidePanel sheet={sheet} open={open} onClose={onClose} nextRef={nextRef} />
            </SheetContent>
        </Sheet>
    );
}

function GuidePanel({ sheet, open, onClose, nextRef }: GuidePanelProps) {
    const reducedMotion = useReducedMotion() ?? false;
    const [index, setIndex] = useState(0);
    const swipeStartX = useRef<number | null>(null);
    const isLast = index === LAST_INDEX;
    const nav = `${sheet}_nav`;

    // 이전 disables on slide 1. Browsers drop the focus of a control that turns disabled onto <body>, outside
    // the dialog, so remember where focus last was and hand it to 다음 (never disabled) when that control
    // has just been disabled (older engines keep it on the disabled control itself, which counts too).
    const lastFocusedRef = useRef<Element | null>(null);
    useEffect(() => {
        const onFocusIn = (event: FocusEvent) => { lastFocusedRef.current = event.target instanceof Element ? event.target : null; };
        document.addEventListener("focusin", onFocusIn);
        return () => document.removeEventListener("focusin", onFocusIn);
    }, []);
    useLayoutEffect(() => {
        const isDisabled = (element: Element | null) => element instanceof HTMLButtonElement && element.disabled;
        const active = document.activeElement;
        const focusLost = !active || active === document.body;
        if (isDisabled(active) || (focusLost && isDisabled(lastFocusedRef.current))) nextRef.current?.focus();
    }, [index, nextRef]);

    // Esc is Radix's; paging by arrow key works wherever the focus is inside the sheet.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "ArrowRight") setIndex((current) => clampIndex(current + 1));
            else if (event.key === "ArrowLeft") setIndex((current) => clampIndex(current - 1));
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { swipeStartX.current = event.clientX; };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (swipeStartX.current == null) return;
        const dx = event.clientX - swipeStartX.current;
        swipeStartX.current = null;
        if (Math.abs(dx) > SWIPE_THRESHOLD_PX) setIndex((current) => clampIndex(current + (dx < 0 ? 1 : -1)));
    };

    return (
        <>
            <div className={styles["sheet-top"]}>
                <ol data-component={`${sheet}_progress`} className={styles.bars} aria-hidden="true">
                    {GUIDE_SLIDES.map((slide, slideIndex) => (
                        <li key={slide.key} className={styles.bar} data-done={slideIndex <= index}>
                            <span className={styles["bar-fill"]} />
                        </li>
                    ))}
                </ol>
                <div className={styles["top-row"]}>
                    <span data-component={`${sheet}_count`} className={styles.count} aria-live="polite">
                        {index + 1} / {SLIDE_COUNT}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-component={`${sheet}_skip`}
                        className={styles.skip}
                        onClick={onClose}
                    >
                        건너뛰기
                    </Button>
                </div>
            </div>

            <div className={styles.viewport} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
                <div
                    className={styles.track}
                    style={{
                        transform: `translateX(${-index * 100}%)`,
                        transition: reducedMotion ? "none" : undefined,
                    }}
                >
                    {GUIDE_SLIDES.map((slide, slideIndex) => {
                        const active = slideIndex === index;
                        const slideBase = `${sheet}_slide-${slide.key}`;
                        return (
                            <article
                                key={slide.key}
                                data-component={slideBase}
                                className={styles.slide}
                                data-active={active}
                                aria-hidden={!active}
                            >
                                {slide.demo ? (
                                    <GuideDemoStage
                                        data-component={`${slideBase}_stage`}
                                        demo={slide.demo}
                                        active={open && active}
                                        reducedMotion={reducedMotion}
                                    />
                                ) : (
                                    <GuideIntroStage data-component={`${slideBase}_stage`} />
                                )}
                                <div data-component={`${slideBase}_caption`} className={styles.cap}>
                                    <span className={styles.chip}>{slide.chip}</span>
                                    <h2 data-component={`${slideBase}_caption_title`} className={styles["cap-title"]}>{slide.title}</h2>
                                    <p data-component={`${slideBase}_caption_body`} className={styles["cap-body"]}>{slide.body}</p>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </div>

            <div data-component={nav} className={styles["sheet-nav"]}>
                <Button
                    type="button"
                    variant="ghost"
                    data-component={`${nav}_prev`}
                    className={`${styles["nav-btn"]} ${styles["nav-prev"]}`}
                    disabled={index === 0}
                    onClick={() => setIndex((current) => clampIndex(current - 1))}
                >
                    이전
                </Button>
                <Button
                    ref={nextRef}
                    type="button"
                    variant="v3"
                    data-component={`${nav}_next`}
                    className={styles["nav-btn"]}
                    onClick={() => (isLast ? onClose() : setIndex((current) => clampIndex(current + 1)))}
                >
                    {isLast ? GUIDE_LAST_BUTTON_LABEL : "다음"}
                </Button>
            </div>
        </>
    );
}
