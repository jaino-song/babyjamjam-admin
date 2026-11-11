import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;
const ROOT = "mobile_messages-complete_mockup";
const MAX_BODY_LENGTH = 2000;
const TEMPLATES = [
  { value: "GREETING", label: "첫 인사" },
  { value: "SERVICE_INFO", label: "서비스 내용 안내" },
  { value: "PRICE_INFO", label: "서비스 비용 안내" },
  { value: "REMINDER", label: "리마인드" },
];

// 미리보기 전용 가상 요금표이며 실제 바우처 가격과 무관합니다.
const SAMPLE_TYPES = [
  { value: "A가1형", label: "A가-1형", dailyGrant: 112000 },
  { value: "A통합1형", label: "A통합-1형", dailyGrant: 98000 },
  { value: "A라1형", label: "A라-1형", dailyGrant: 70000 },
];
const SAMPLE_DURATIONS = [
  { value: "5", label: "1주 (5일)" },
  { value: "10", label: "2주 (10일)" },
  { value: "15", label: "3주 (15일)" },
];
const SAMPLE_REGIONS = [
  { value: "sample-a", label: "가상지역 A", bankName: "예시은행", accNum: "샘플계좌 A (입금 불가)" },
  { value: "sample-b", label: "가상지역 B", bankName: "가상은행", accNum: "샘플계좌 B (입금 불가)" },
];
const SAMPLE_YEARS = [
  { value: "2025", label: "2025년", dailyFullPrice: 135000 },
  { value: "2026", label: "2026년", dailyFullPrice: 140000 },
  { value: "2027", label: "2027년", dailyFullPrice: 145000 },
];

// 기존 fallback 템플릿의 문단과 변수를 유지하되 업체·계좌는 가상 값으로 대체합니다.
const PRICE_INFO_BODY = `[사회서비스 제공자 품질평가 A등급]

{{name}} 산모님~♡

정부지원 바우처 서비스 비용 관련해서 안내 드립니다 :)

서비스 기간:
출퇴근 {{weeks}}주 (평일기준 {{days}}일)
정부지원 바우처 유형:
{{type}}

기본 서비스 금액은
총 {{fullPrice}}원이며,
정부 지원금액은
{{grant}}원 입니다.

산모님께서 부담하시는 금액은
{{actualPrice}}원 입니다.

서비스 예약을 위해
선납하실 예약금은
100,000원 입니다.

예약금 입금 후에
서비스 예약이 확정 됩니다.

입금 계좌번호:
{{bankName}} {{accNum}}
예금주: 예시 산후케어 (가상 업체)

입금시 입금자명을 꼭 기재해 주세요 :)
(타인 계좌에서 송금시 산모님 성함 기재 필수)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`;

const MESSAGE_BODIES = {
  PRICE_INFO: PRICE_INFO_BODY,
  SERVICE_INFO: `[사회서비스 제공자 품질평가 A등급]
{{name}} 산모님~♡

산후관리서비스 관련 안내사항을 보내드립니다 :)

1. 관리사님의 근무시간은 오전 9시부터 오후 6시까지이며 점심 식사 시간이 포함된 1시간 휴게시간이 있습니다. 휴게시간은 산모님과 관리사님이 서로 잘 조율하셔서 사용하시면 됩니다.

2. 관리사님께서 하시는 주 업무는 신생아 케어 (신생아 목욕, 신생아 빨래, 수유, 젖병 삶기 등), 산모 음식 준비, 아기와 산모가 머무는 방의 청소와 거실과 화장실의 간단한 청소 등의 일들을 하시는데 묵은 빨래, 대청소, 베란다 청소 등의 과중한 일들은 하지 않습니다.

3. 산모님께서 도움이 필요한 일이 생겼을 시에, 제공 서비스 범위 내에서 최대한 도와드립니다. 그리고 산모님께서 젖몸살이 오면 케어해주십니다.

4. 궁금하신 점 있으시면 언제든지 문자 또는 연락 주세요 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  GREETING: `[사회서비스 제공자 품질평가 A등급]
{{name}} 산모님, 안녕하세요. 예시 산후케어입니다 :)

예시 산후케어는 아기들의 건강과 엄마들의 안정을 최우선으로 하는 전문적인 산모 및 신생아 관리프로그램을 약속드립니다.

궁금하신 점은 편하게 말씀해 주세요.
아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  REMINDER: `[사회서비스 제공자 품질평가 A등급]
{{name}} 산모님~♡

아가 예뻐하시고 케어 잘하시는
프리미엄급 관리사님으로 매칭 되도록 최대한 신경쓰겠습니다~

저도 서비스가 종료되는 때까지 산모님께서
편안하고 행복하게 서비스 받으시는지
지속적으로 체크하고 신경 써서
산모님께서 만족하시는 서비스가 되도록 최선을 다하겠습니다 :)

가족 분들과 편히 상의하시고 말씀해 주세요~ 연락 기다리겠습니다 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
};

function attributes(base, slot, source) {
  return {
    "data-component": base,
    "data-slot": slot,
    ...(source ? { "data-source-component": source } : {}),
    className: slot,
  };
}

function generateBody(template, values) {
  const days = Number(values.duration);
  const type = SAMPLE_TYPES.find((item) => item.value === values.type);
  const region = SAMPLE_REGIONS.find((item) => item.value === values.region);
  const year = SAMPLE_YEARS.find((item) => item.value === values.year);
  const fullPrice = year.dailyFullPrice * days;
  const grant = type.dailyGrant * days;
  const money = (amount) => amount.toLocaleString("ko-KR");
  const variables = {
    name: values.name.trim() || "{{name}}",
    weeks: days / 5,
    days,
    type: type.label,
    fullPrice: money(fullPrice),
    grant: money(grant),
    actualPrice: money(fullPrice - grant),
    bankName: region.bankName,
    accNum: region.accNum,
  };
  return MESSAGE_BODIES[template].replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match);
}

export function MockupIcon({ "data-component": base, kind }) {
  const paths = {
    send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
    complete: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6", "m8 15 2 2 5-5"],
    history: ["M3 12a9 9 0 1 0 2.6-6.4L3 8", "M3 3v5h5", "M12 7v5l3 2"],
    templates: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6", "M8 13h8", "M8 17h6"],
    automatic: ["M12 5v5", "M6 14v-4h12v4", "M3 14h6v6H3Z", "M15 14h6v6h-6Z", "M9 2h6v4H9Z"],
    settings: ["M4 6h16", "M4 12h16", "M4 18h16", "M8 3v6", "M16 9v6", "M10 15v6"],
    chevron: ["m6 9 6 6 6-6"],
  };
  return h("svg", {
    ...attributes(base, "icon", "MockupIcon"),
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  }, paths[kind].map((d, index) => h("path", { key: index, d })));
}

export function MockupSectionNav({ "data-component": base }) {
  const sections = [
    ["send", "전송하기"], ["complete", "메시지 완성"], ["history", "발송 기록"],
    ["templates", "템플릿"], ["automatic", "자동 전송"], ["settings", "설정"],
  ];
  return h("nav", { ...attributes(base, "section-nav", "MockupSectionNav"), "aria-label": "메시지 기능" },
    h("div", attributes(`${base}_items`, "section-nav-items"), sections.map(([id, label]) =>
      h("span", {
        ...attributes(`${base}_items_${id}`, "section-nav-item"), key: id,
        "aria-current": id === "complete" ? "page" : undefined,
      }, h(MockupIcon, { "data-component": `${base}_items_${id}_icon`, kind: id }), label),
    )),
  );
}

export function MockupFieldLabel({ "data-component": base, inputId, label, required = true }) {
  return h("div", attributes(base, "field-label-row", "MockupFieldLabel"),
    h("label", { ...attributes(`${base}_label`, "field-label"), htmlFor: inputId }, label,
      required ? h("span", { ...attributes(`${base}_label_required`, "field-required"), "aria-hidden": true }, "*") : null),
  );
}

export function MockupSelectField({ "data-component": base, inputId, label, value, options, onChange }) {
  return h("div", attributes(base, "form-section", "MockupSelectField"),
    h(MockupFieldLabel, { "data-component": `${base}_label-row`, inputId, label }),
    h("div", attributes(`${base}_control`, "select-control"),
      h("select", {
        ...attributes(`${base}_control_select`, "field-select"),
        id: inputId, value, required: true, onChange: (event) => onChange(event.target.value),
      }, options.map((option) => h("option", { key: option.value, value: option.value }, option.label))),
      h(MockupIcon, { "data-component": `${base}_control_icon`, kind: "chevron" }),
    ),
  );
}

export function MockupNameField({ "data-component": base, value, onChange }) {
  return h("div", attributes(base, "form-section", "MockupNameField"),
    h(MockupFieldLabel, { "data-component": `${base}_label-row`, inputId: "name", label: "산모님 성함" }),
    h("input", {
      ...attributes(`${base}_input`, "field-input"), id: "name", type: "text", value,
      placeholder: "산모님 성함", autoComplete: "off", required: true, maxLength: 80,
      onChange: (event) => onChange(event.target.value),
    }),
  );
}

function copyWithSelection(text, owner, base) {
  const focused = document.activeElement;
  const selectionStart = focused?.selectionStart;
  const selectionEnd = focused?.selectionEnd;
  const selectionDirection = focused?.selectionDirection;
  const scrollTop = focused?.scrollTop;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.className = "clipboard-fallback";
  temporary.setAttribute("data-component", `${base}_clipboard-fallback`);
  temporary.setAttribute("data-slot", "clipboard-fallback");
  temporary.setAttribute("aria-label", "복사할 메시지");
  temporary.setAttribute("readonly", "");
  owner.appendChild(temporary);
  try {
    temporary.focus({ preventScroll: true });
    temporary.select();
    temporary.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    temporary.remove();
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
    if (focused instanceof HTMLElement) {
      focused.focus({ preventScroll: true });
      if (typeof selectionStart === "number" && typeof focused.setSelectionRange === "function") {
        focused.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
        focused.scrollTop = scrollTop;
      }
    }
  }
}

export function MockupMessageBody({ "data-component": base, value, onChange }) {
  const [copyStatus, setCopyStatus] = useState("");
  const [isCopying, setIsCopying] = useState(false);
  const ownerRef = useRef(null);

  async function copy() {
    setIsCopying(true);
    setCopyStatus("");
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          copied = true;
        } catch {
          // HTTP 또는 브라우저 권한 제한 시 선택 기반 복사를 시도합니다.
        }
      }
      if (!copied) copied = copyWithSelection(value, ownerRef.current, base);
      setCopyStatus(copied ? "복사했어요" : "복사하지 못했어요. 본문을 선택해 복사해 주세요.");
    } catch {
      setCopyStatus("복사하지 못했어요. 본문을 선택해 복사해 주세요.");
    } finally {
      setIsCopying(false);
    }
  }

  return h("div", { ...attributes(base, "form-section", "MockupMessageBody"), ref: ownerRef },
    h("div", attributes(`${base}_header`, "message-header"),
      h(MockupFieldLabel, { "data-component": `${base}_header_label-row`, inputId: "message-body", label: "메시지 본문", required: false }),
      h("button", {
        ...attributes(`${base}_header_copy`, "copy-action"), type: "button", disabled: isCopying, onClick: copy,
      }, "복사"),
    ),
    h("div", attributes(`${base}_field`, "message-field"),
      h("textarea", {
        ...attributes(`${base}_field_textarea`, "message-textarea"), id: "message-body", rows: 12,
        maxLength: MAX_BODY_LENGTH, value, spellCheck: false,
        "aria-describedby": copyStatus ? `${base}-copy-status` : undefined,
        onChange: (event) => { setCopyStatus(""); onChange(event.target.value); },
      }),
    ),
    copyStatus ? h("p", {
      ...attributes(`${base}_copy-status`, "copy-status"), id: `${base}-copy-status`, role: "status", "aria-live": "polite",
    }, copyStatus) : null,
  );
}

export function MessageCompleteMockup() {
  const [template, setTemplate] = useState("PRICE_INFO");
  const [values, setValues] = useState({ name: "", type: "A가1형", duration: "10", region: "sample-a", year: "2026" });
  const [bodyOverride, setBodyOverride] = useState(null);
  const [revision, setRevision] = useState(0);
  const formBase = `${ROOT}_card_form`;
  const body = bodyOverride ?? generateBody(template, values);

  function updateVariable(key, value) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setBodyOverride(null);
    setRevision((previous) => previous + 1);
  }

  function changeTemplate(value) {
    setTemplate(value);
    setBodyOverride(null);
    setRevision((previous) => previous + 1);
  }

  return h("main", attributes(ROOT, "preview-screen", "MessageCompleteMockup"),
    h(MockupSectionNav, { "data-component": `${ROOT}_navigation` }),
    h("section", { ...attributes(`${ROOT}_card`, "list-card"), "aria-labelledby": "card-title" },
      h("header", attributes(`${ROOT}_card_header`, "list-title"),
        h("h1", { ...attributes(`${ROOT}_card_header_title`, "list-title-text"), id: "card-title" }, "메시지 완성")),
      h("div", attributes(formBase, "form-content"),
        h(MockupSelectField, {
          "data-component": `${formBase}_template`, inputId: "template", label: "템플릿 선택",
          value: template, options: TEMPLATES, onChange: changeTemplate,
        }),
        h(MockupNameField, {
          "data-component": `${formBase}_name`, value: values.name, onChange: (value) => updateVariable("name", value),
        }),
        template === "PRICE_INFO" ? [
          ["type", "price-info-type", "바우처 유형", SAMPLE_TYPES],
          ["duration", "price-info-duration", "서비스 기간", SAMPLE_DURATIONS],
          ["region", "price-info-region", "지역", SAMPLE_REGIONS],
          ["year", "price-info-year", "바우처 연도", SAMPLE_YEARS],
        ].map(([key, inputId, label, options]) => h(MockupSelectField, {
          key, "data-component": `${formBase}_price-${key}`, inputId, label, options,
          value: values[key], onChange: (value) => updateVariable(key, value),
        })) : null,
        h(MockupMessageBody, {
          key: `${template}-${revision}`, "data-component": `${formBase}_message-body`, value: body, onChange: setBodyOverride,
        }),
      ),
    ),
    h("p", attributes(`${ROOT}_preview-note`, "preview-note"), "미리보기 · 모든 이름·요금·지역·계좌는 가상 예시입니다."),
  );
}

createRoot(document.getElementById("root")).render(h(MessageCompleteMockup));
