import type { ReactNode } from "react";

import type { DemoName } from "./guideDemos";

/** One guide slide: its caption (final approved copy) and, for the six demos, which script plays. */
export interface GuideSlide {
    /** Segment of the slide's `data-component` (`…_slide-<key>`). */
    key: "intro" | DemoName;
    chip: string;
    title: string;
    body: ReactNode;
    demo: DemoName | null;
}

export const GUIDE_TITLE = "제공기록지 작성 가이드";
export const GUIDE_LAST_BUTTON_LABEL = "기본정보 입력 시작";

export const GUIDE_SLIDES: readonly GuideSlide[] = [
    {
        key: "intro",
        chip: "제공기록지 작성 가이드",
        title: "처음이세요? 사용방법을 알려드려요",
        body: "다음을 눌러 하나씩 살펴보세요.",
        demo: null,
    },
    {
        key: "basics",
        chip: "서비스 기본정보",
        title: "산모·신생아 정보를 먼저 입력해요",
        body: <>처음 한 번만 입력하면 돼요. 날짜는 <b>숫자 8자리</b>로, 이름은 <b>띄어쓰기 없이</b> 적어 주세요. 모든 항목을 작성하고 [다음] 버튼을 누르면 저장돼요.</>,
        demo: "basics",
    },
    {
        key: "grid",
        chip: "제공기록표",
        title: "오늘 날짜 버튼을 눌러 기록을 시작하세요",
        body: "\"입력 가능 날짜\"로 표시된 버튼을 누르면 돼요.",
        demo: "grid",
    },
    {
        key: "form",
        chip: "서비스 제공 기록 작성",
        title: "서비스 제공 기록을 작성해 주세요",
        body: "필수 항목들을 모두 작성 및 선택하고 [다음]을 눌러 주세요.",
        demo: "form",
    },
    {
        key: "sign",
        chip: "산모 서명 · 최종 제출",
        title: "최종 확인 후 산모님께 서명을 받아요",
        body: "기록 내용을 확인하고 산모님께 확인 서명을 받아주세요.",
        demo: "sign",
    },
    {
        key: "edit",
        chip: "제출한 기록 수정",
        title: "이미 제출한 기록도 수정이 가능해요",
        body: "수정이 필요한 부분만 수정하고 제출해 주세요.",
        demo: "edit",
    },
    {
        key: "sched",
        chip: "서비스 일정 변경",
        title: "하루 쉬어가나요? 일정을 변경해 보세요",
        body: "서비스 제공일을 하루 늦출 수 있어요. 최종 처리는 본사에서 승인 후 완료돼요.",
        demo: "sched",
    },
];

/** The intro slide's four step cards. */
export const INTRO_STEPS: readonly { title: string; sub: string }[] = [
    { title: "서비스 기본정보", sub: "처음 한 번만 입력" },
    { title: "회차 카드 선택", sub: "제공기록표에서 오늘 회차" },
    { title: "회차 기록 작성", sub: "산모 · 신생아 · 서비스" },
    { title: "산모 서명 후 제출", sub: "확인 → 제출완료" },
];
