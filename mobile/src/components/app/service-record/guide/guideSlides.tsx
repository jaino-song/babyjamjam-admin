import type { ReactNode } from "react";

import type { DemoName } from "./guideDemos";

/** One guide slide: its caption (final approved copy) and, for the five demos, which script plays. */
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
        title: "\"입력 가능\" 회차를 눌러 기록을 시작하세요",
        body: "기록할 서비스 제공일을 선택해 주세요.",
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
        title: "제출한 기록도 고치거나 지울 수 있어요",
        body: <><b>서비스 제공일</b>과 내용을 고쳐 다시 제출할 수 있어요. 필요한 경우엔 기록을 삭제할 수도 있어요.</>,
        demo: "edit",
    },
];

/** The intro slide's five step cards. */
export const INTRO_STEPS: readonly { title: string; sub: string }[] = [
    { title: "서비스 기본정보", sub: "처음 한 번만 입력" },
    { title: "회차 카드 선택", sub: "제공기록표에서 입력 가능 회차" },
    { title: "서비스 제공일 선택", sub: "달력에서 날짜 고르기" },
    { title: "회차 기록 작성", sub: "산모 · 신생아 · 서비스" },
    { title: "산모 서명 후 제출", sub: "확인 → 제출완료" },
];
