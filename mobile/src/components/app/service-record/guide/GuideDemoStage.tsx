"use client";

import { useLayoutEffect, useRef } from "react";

import { renderInitialFrame, renderStaticFrame, startDemo, type DemoName } from "./guideDemos";
import styles from "./ServiceRecordGuide.module.css";
import { useStageFit } from "./useStageFit";

const SOURCE_COMPONENT = "GuideDemoStage";

/** These demos close a dark spotlight frame onto a card or button. */
const SPOTLIGHT_DEMOS: readonly DemoName[] = ["grid", "edit"];

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

    useStageFit(frameRef, 520);

    useLayoutEffect(() => {
        if (!miniRef.current) return;
        if (reducedMotion) renderStaticFrame(demo, miniRef.current);
        else renderInitialFrame(demo, miniRef.current);
    }, [demo, reducedMotion]);

    useLayoutEffect(() => {
        if (!active || reducedMotion) return;
        const stage = stageRef.current;
        const m = miniRef.current;
        const touch = touchRef.current;
        const fill = fillRef.current;
        if (!stage || !m || !touch || !fill) return;
        return startDemo(demo, { stage, m, touch, spot: spotRef.current, fill });
    }, [active, demo, reducedMotion]);

    return (
        <div
            ref={frameRef}
            data-component={base}
            data-source-component={SOURCE_COMPONENT}
            data-slot="stage"
            className={styles.stage}
            aria-hidden="true"
        >
            <div ref={stageRef} data-component={`${base}_fit`} data-slot="stage-fit" className={styles["stage-fit"]}>
                <div ref={miniRef} data-component={`${base}_mini-screen`} data-slot="m" className={styles.m} />
                {SPOTLIGHT_DEMOS.includes(demo) ? <span ref={spotRef} data-component={`${base}_spotlight`} data-slot="spot" className={styles.spot} /> : null}
                <span ref={touchRef} data-component={`${base}_touch`} data-slot="touch" className={styles.touch} />
            </div>
            {reducedMotion ? null : (
                <span data-component={`${base}_progress`} data-slot="prog" className={styles.prog}>
                    <span ref={fillRef} data-slot="prog-fill" className={styles["prog-fill"]} />
                </span>
            )}
        </div>
    );
}
