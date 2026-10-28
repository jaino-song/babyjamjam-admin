"use client";

import { useEffect, useRef } from "react";

import { renderStaticFrame, startDemo, type DemoName } from "./guideDemos";
import styles from "./ServiceRecordGuide.module.css";
import { useStageFit } from "./useStageFit";

const SOURCE_COMPONENT = "GuideDemoStage";

/** The slide track takes 500ms to bring a slide in; the demo starts right after. */
const DEMO_START_DELAY_MS = 520;

/** These demos close a dark spotlight frame onto a card or button. */
const SPOTLIGHT_DEMOS: readonly DemoName[] = ["grid", "edit", "sched"];

export interface GuideDemoStageProps {
    "data-component": string;
    demo: DemoName;
    /** Only the slide on screen plays. */
    active: boolean;
    /** Reduced motion: no script runs, the mini screen shows its end state. */
    reducedMotion: boolean;
}

/**
 * One demo slide's stage: a decorative miniature of the real screen (drawn imperatively into a ref
 * by `guideDemos`), the touch indicator, an optional spotlight frame and the loop's progress bar.
 * The whole stage is `aria-hidden`; the caption below it carries the meaning.
 */
export function GuideDemoStage({ "data-component": base, demo, active, reducedMotion }: GuideDemoStageProps) {
    // The frame clips; the fit layer inside it is what the demo script measures, so its touch / spotlight
    // coordinates stay right however far `useStageFit` has scaled the illustration down.
    const frameRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const miniRef = useRef<HTMLDivElement>(null);
    const touchRef = useRef<HTMLSpanElement>(null);
    const spotRef = useRef<HTMLSpanElement>(null);
    const fillRef = useRef<HTMLSpanElement>(null);

    useStageFit(frameRef);

    useEffect(() => {
        if (reducedMotion && miniRef.current) renderStaticFrame(demo, miniRef.current);
    }, [demo, reducedMotion]);

    useEffect(() => {
        if (!active || reducedMotion) return;
        const stage = stageRef.current;
        const m = miniRef.current;
        const touch = touchRef.current;
        const fill = fillRef.current;
        if (!stage || !m || !touch || !fill) return;
        let stop: (() => void) | null = null;
        const timer = setTimeout(() => {
            stop = startDemo(demo, { stage, m, touch, spot: spotRef.current, fill });
        }, DEMO_START_DELAY_MS);
        return () => {
            clearTimeout(timer);
            stop?.();
        };
    }, [active, demo, reducedMotion]);

    return (
        <div
            ref={frameRef}
            data-component={base}
            data-source-component={SOURCE_COMPONENT}
            className={styles.stage}
            aria-hidden="true"
        >
            <div ref={stageRef} data-component={`${base}_fit`} data-slot="stage-fit" className={styles["stage-fit"]}>
                <div ref={miniRef} data-component={`${base}_mini-screen`} className={styles.m} />
                {SPOTLIGHT_DEMOS.includes(demo) ? <span ref={spotRef} data-component={`${base}_spotlight`} className={styles.spot} /> : null}
                <span ref={touchRef} data-component={`${base}_touch`} className={styles.touch} />
            </div>
            {reducedMotion ? null : (
                <span data-component={`${base}_progress`} className={styles.prog}>
                    <span ref={fillRef} className={styles["prog-fill"]} />
                </span>
            )}
        </div>
    );
}
