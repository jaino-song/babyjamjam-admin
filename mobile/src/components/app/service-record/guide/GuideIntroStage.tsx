"use client";

import { useRef } from "react";

import { INTRO_STEPS } from "./guideSlides";
import styles from "./ServiceRecordGuide.module.css";
import { useStageFit } from "./useStageFit";

const SOURCE_COMPONENT = "GuideIntroStage";

/** The first slide's stage: a pen writing on a sheet, then five step cards rising in one by one. */
export function GuideIntroStage({ "data-component": base }: { "data-component": string }) {
    const frameRef = useRef<HTMLDivElement>(null);
    useStageFit(frameRef, 470);

    return (
        <div ref={frameRef} data-component={base} data-source-component={SOURCE_COMPONENT} data-slot="stage" className={styles.stage}>
            <div data-component={`${base}_fit`} data-slot="stage-fit" className={styles["stage-fit"]}>
                <div data-slot="intro" className={styles.intro}>
                    <div data-slot="intro-hero" className={styles["intro-hero"]} aria-hidden="true">
                        <div data-slot="doc" className={styles.doc}>
                            <i data-slot="doc-line" className={styles["doc-line"]} />
                            <i data-slot="doc-line" className={styles["doc-line"]} />
                            <i data-slot="doc-line" className={styles["doc-line"]} />
                            <i data-slot="doc-line" className={styles["doc-line"]} />
                            <span data-slot="pen" className={styles.pen} />
                        </div>
                    </div>
                    <ol data-slot="steps" className={styles.steps}>
                        {INTRO_STEPS.map((step, index) => (
                            <li
                                key={step.title}
                                data-component={`${base}_step-${index + 1}`}
                                data-slot="st"
                                className={styles.st}
                                style={{ animationDelay: `${index * 0.25}s` }}
                            >
                                <span data-slot="st-no" className={styles["st-no"]} aria-hidden="true">{index + 1}</span>
                                <div>
                                    <b data-slot="st-name" className={styles["st-name"]}>{step.title}</b>
                                    <small data-slot="st-sub" className={styles["st-sub"]}>{step.sub}</small>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    );
}
