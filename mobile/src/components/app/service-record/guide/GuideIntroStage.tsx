"use client";

import { useRef } from "react";

import { INTRO_STEPS } from "./guideSlides";
import styles from "./ServiceRecordGuide.module.css";
import { useStageFit } from "./useStageFit";

const SOURCE_COMPONENT = "GuideIntroStage";

/** The first slide's stage: a pen writing on a sheet, then four step cards rising in one by one. */
export function GuideIntroStage({ "data-component": base }: { "data-component": string }) {
    const frameRef = useRef<HTMLDivElement>(null);
    useStageFit(frameRef);

    return (
        <div ref={frameRef} data-component={base} data-source-component={SOURCE_COMPONENT} className={styles.stage}>
            <div data-component={`${base}_fit`} data-slot="stage-fit" className={styles["stage-fit"]}>
                <div className={styles.intro}>
                    <div className={styles["intro-hero"]} aria-hidden="true">
                        <div className={styles.doc}>
                            <i className={styles["doc-line"]} />
                            <i className={styles["doc-line"]} />
                            <i className={styles["doc-line"]} />
                            <i className={styles["doc-line"]} />
                            <span className={styles.pen} />
                        </div>
                    </div>
                    <ol className={styles.steps}>
                        {INTRO_STEPS.map((step, index) => (
                            <li
                                key={step.title}
                                data-component={`${base}_step-${index + 1}`}
                                className={styles.st}
                                style={{ animationDelay: `${index * 0.25}s` }}
                            >
                                <span className={styles["st-no"]} aria-hidden="true">{index + 1}</span>
                                <div>
                                    <b className={styles["st-name"]}>{step.title}</b>
                                    <small className={styles["st-sub"]}>{step.sub}</small>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    );
}
