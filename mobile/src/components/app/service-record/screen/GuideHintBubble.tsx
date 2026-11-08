"use client";

import styles from "./GuideHintBubble.module.css";

const SOURCE_COMPONENT = "GuideHintBubble";
const HINT_TEXT = "사용방법을 다시 확인해 보세요";
const CLOSE_LABEL = "안내 닫기";
const CLOSE_CONTENT = "✕";

type GuideHintBubbleProps = {
    "data-component": string;
    onClose: () => void;
};

export function GuideHintBubble(props: GuideHintBubbleProps) {
    return (
        <div
            data-component={props["data-component"]}
            data-slot="bubble"
            data-source-component={SOURCE_COMPONENT}
            role="status"
            className={styles.bubble}
        >
            {HINT_TEXT}
            <button
                data-component={`${props["data-component"]}_close`}
                data-slot="close"
                type="button"
                aria-label={CLOSE_LABEL}
                className={styles.close}
                onClick={props.onClose}
            >
                {CLOSE_CONTENT}
            </button>
        </div>
    );
}
