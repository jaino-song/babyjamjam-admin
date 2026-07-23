/* Babyjamjam Admin DS — browser bundle. Load with babel AFTER React. Exposes window.BJJ */

const React = window.React;

// ---- primitives/Button ----
const __css_Button=`
.bjj-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;border-radius:var(--radius-pill);border:2px solid transparent;font-family:var(--font-sans);font-weight:600;cursor:pointer;transition:all var(--duration-pop) var(--ease-standard);text-decoration:none;}
.bjj-btn:active{transform:scale(0.98);}
.bjj-btn:disabled{pointer-events:none;opacity:.5;}
.bjj-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--background),0 0 0 4px var(--ring);}
.bjj-btn--size-default{height:40px;padding:0 16px;font-size:var(--text-base);}
.bjj-btn--size-sm{height:36px;padding:0 12px;font-size:var(--text-sm);}
.bjj-btn--size-lg{height:48px;padding:0 32px;font-size:1rem;}
.bjj-btn--size-icon{height:40px;width:40px;padding:0;}
.bjj-btn--primary{background:var(--primary);color:var(--primary-foreground);box-shadow:var(--shadow-card);}
.bjj-btn--primary:hover{transform:translateY(-2px);background:var(--primary-hover);box-shadow:var(--shadow-hover);}
.bjj-btn--destructive{background:var(--burgundy);color:#fff;box-shadow:0 4px 24px hsla(348,40%,24%,0.08);}
.bjj-btn--destructive:hover{transform:translateY(-2px);box-shadow:0 12px 48px hsla(348,40%,24%,0.16);}
.bjj-btn--neutral{background:var(--card);color:var(--text-muted);border-color:var(--border);}
.bjj-btn--neutral:hover{background:var(--surface);color:var(--dark);}
.bjj-btn--subtle{background:var(--primary-light);color:var(--primary);}
.bjj-btn--subtle:hover{background:var(--primary-medium);}
.bjj-btn--outline{background:var(--card);color:var(--primary);border-color:var(--primary);}
.bjj-btn--outline:hover{background:var(--primary-light);}
.bjj-btn--ghost{background:transparent;color:var(--text);}
.bjj-btn--ghost:hover{background:var(--surface);}
.bjj-btn--link{background:transparent;color:var(--primary);}
.bjj-btn--link:hover{text-decoration:underline;}
.bjj-btn--kakao{background:var(--kakao);color:var(--kakao-foreground);border:1px solid var(--border);}
.bjj-btn--kakao:hover{filter:brightness(0.96);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-button")){const s=document.createElement("style");s.id="bjj-css-button";s.textContent=__css_Button;document.head.appendChild(s);}
const BTN_WIDTHS = { sm: "25%", md: "50%", lg: "100%" };
/** height: sm 36 / default 40 / lg 48 / icon 40×40. width: sm 25% / md 50% / lg 100% of container. (size/fullWidth kept as deprecated aliases.) */
function Button({ variant = "primary", height, size = "default", width, icon, fullWidth, children, className, style, ...rest }) {
  const cls = ["bjj-btn", "bjj-btn--" + variant, "bjj-btn--size-" + (height || size), className].filter(Boolean).join(" ");
  const w = BTN_WIDTHS[width] || (fullWidth ? "100%" : undefined);
  return (
    <button className={cls} style={w ? { width: w, ...style } : style} {...rest}>
      {icon}
      {children}
    </button>
  );
}

// ---- primitives/Badge ----
const __css_Badge=`
.bjj-badge{display:inline-flex;align-items:center;justify-content:center;gap:4px;border-radius:var(--radius-pill);border:1px solid transparent;padding:2px 8px;font-size:var(--text-sm);font-weight:500;white-space:nowrap;font-family:var(--font-sans);}
.bjj-badge--default{background:var(--primary);color:var(--primary-foreground);}
.bjj-badge--secondary{background:var(--status-neutral-bg);color:var(--text-muted);border-color:var(--status-neutral-border);}
.bjj-badge--outline{background:transparent;color:var(--foreground);border-color:var(--border);}
.bjj-badge--destructive{background:var(--destructive);color:#fff;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-badge")){const s=document.createElement("style");s.id="bjj-css-badge";s.textContent=__css_Badge;document.head.appendChild(s);}
function Badge({ variant = "default", children, className, ...rest }) {
  return <span className={["bjj-badge", "bjj-badge--" + variant, className].filter(Boolean).join(" ")} {...rest}>{children}</span>;
}

// ---- primitives/StatusBadge ----
const __css_StatusBadge=`
.bjj-status{display:inline-flex;align-items:center;justify-content:center;gap:4px;border-radius:var(--radius-pill);border:1px solid;padding:4px 12px;font-size:var(--text-2xs);font-weight:600;line-height:1;white-space:nowrap;font-family:var(--font-sans);}
.bjj-status--lg{padding:6px 14px;font-size:var(--text-sm);}
.bjj-status--neutral{background:var(--status-neutral-bg);border-color:var(--status-neutral-border);color:var(--status-neutral-fg);}
.bjj-status--info{background:var(--status-info-bg);border-color:var(--status-info-border);color:var(--status-info-fg);}
.bjj-status--success{background:var(--status-success-bg);border-color:var(--status-success-border);color:var(--status-success-fg);}
.bjj-status--warning{background:var(--status-warning-bg);border-color:var(--status-warning-border);color:var(--status-warning-fg);}
.bjj-status--danger{background:var(--status-danger-bg);border-color:var(--status-danger-border);color:var(--status-danger-fg);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-status")){const s=document.createElement("style");s.id="bjj-css-status";s.textContent=__css_StatusBadge;document.head.appendChild(s);}
const STATUS_LABELS = {
  active: ["진행중", "info"], signed: ["서명완료", "success"], pending: ["대기", "warning"],
  review: ["검토 필요", "info"], scheduleChange: ["일정 변경", "danger"], terminated: ["중단", "danger"],
  expired: ["만료", "danger"], completed: ["완료", "success"], breastPump: ["유축기 대여", "info"], careCenter: ["조리원 이용", "info"],
};
function StatusBadge({ variant, status, size = "default", children, className, ...rest }) {
  let v = variant, label = children;
  if (status && STATUS_LABELS[status]) {
    if (!v) v = STATUS_LABELS[status][1];
    if (label == null) label = STATUS_LABELS[status][0];
  }
  const cls = ["bjj-status", "bjj-status--" + (v || "neutral"), size === "lg" ? "bjj-status--lg" : "", className].filter(Boolean).join(" ");
  return <span className={cls} {...rest}>{label}</span>;
}

// ---- primitives/TagPill ----
const __css_TagPill=`
.bjj-tag{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-pill);padding:4px 10px;font-size:var(--text-xs);font-weight:500;line-height:1;white-space:nowrap;font-family:var(--font-sans);}
.bjj-tag--lg{padding:6px 12px;font-size:var(--text-sm);}
.bjj-tag--neutral{background:var(--status-neutral-bg);color:var(--text-muted);}
.bjj-tag--amber{background:#fef3c7;color:#b45309;}
.bjj-tag--emerald{background:#d1fae5;color:#047857;}
.bjj-tag--sky{background:#e0f2fe;color:#0369a1;}
.bjj-tag--cyan{background:#cffafe;color:#0e7490;}
.bjj-tag--indigo{background:#e0e7ff;color:#4338ca;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-tag")){const s=document.createElement("style");s.id="bjj-css-tag";s.textContent=__css_TagPill;document.head.appendChild(s);}
function TagPill({ variant = "neutral", size = "default", children, className, ...rest }) {
  const cls = ["bjj-tag", "bjj-tag--" + variant, size === "lg" ? "bjj-tag--lg" : "", className].filter(Boolean).join(" ");
  return <span className={cls} {...rest}>{children}</span>;
}

// ---- primitives/Avatar ----
const __css_Avatar=`
.bjj-avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;font-weight:700;font-family:var(--font-sans);flex-shrink:0;overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,0.12);}
.bjj-avatar img{width:100%;height:100%;object-fit:cover;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-avatar")){const s=document.createElement("style");s.id="bjj-css-avatar";s.textContent=__css_Avatar;document.head.appendChild(s);}
const AV_SIZES = { sm: [32, "0.7rem"], default: [40, "0.85rem"], lg: [48, "1rem"] };
function Avatar({ name = "", src, size = "default", className, style, ...rest }) {
  const [px, fs] = AV_SIZES[size] || AV_SIZES.default;
  const initials = name ? name.slice(0, 2).toUpperCase() : "?";
  return (
    <span className={["bjj-avatar", className].filter(Boolean).join(" ")} style={{ width: px, height: px, fontSize: fs, ...style }} {...rest}>
      {src ? <img src={src} alt={name} /> : initials}
    </span>
  );
}

// ---- primitives/Skeleton ----
const __css_Skeleton=`
.bjj-skeleton{background:var(--surface);border-radius:var(--radius-sm);animation:bjj-pulse 2s ease-in-out infinite;display:block;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-skeleton")){const s=document.createElement("style");s.id="bjj-css-skeleton";s.textContent=__css_Skeleton;document.head.appendChild(s);}
function Skeleton({ width, height = 16, round, className, style, ...rest }) {
  return <span className={["bjj-skeleton", className].filter(Boolean).join(" ")} style={{ width: width ?? "100%", height, borderRadius: round ? "var(--radius-pill)" : undefined, ...style }} {...rest} />;
}

// ---- primitives/Spinner ----
const __css_Spinner=`
.bjj-spinner{animation:bjj-spin 0.8s linear infinite;color:var(--primary);}
@keyframes bjj-spin{to{transform:rotate(360deg);}}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-spinner")){const s=document.createElement("style");s.id="bjj-css-spinner";s.textContent=__css_Spinner;document.head.appendChild(s);}
const SP_SIZES = { sm: 16, default: 24, lg: 32 };
function Spinner({ size = "default", className, style, ...rest }) {
  const px = SP_SIZES[size] || SP_SIZES.default;
  return (
    <svg className={["bjj-spinner", className].filter(Boolean).join(" ")} style={style} width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...rest}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ---- primitives/Separator ----
const __css_Separator=`
.bjj-separator{background:var(--border);border:none;flex-shrink:0;}
.bjj-separator--h{height:1px;width:100%;}
.bjj-separator--v{width:1px;align-self:stretch;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-separator")){const s=document.createElement("style");s.id="bjj-css-separator";s.textContent=__css_Separator;document.head.appendChild(s);}
function Separator({ orientation = "horizontal", className, ...rest }) {
  return <div className={["bjj-separator", orientation === "vertical" ? "bjj-separator--v" : "bjj-separator--h", className].filter(Boolean).join(" ")} {...rest} />;
}

// ---- primitives/EmptyState ----
const __css_EmptyState=`
.bjj-empty{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);display:flex;align-items:center;justify-content:center;min-height:200px;height:100%;}
.bjj-empty__inner{text-align:center;color:var(--text-muted);}
.bjj-empty__icon{opacity:0.3;margin:0 auto 12px;display:flex;justify-content:center;}
.bjj-empty__msg{font-size:var(--text-base);margin:0;}
.bjj-empty--plain{background:transparent;box-shadow:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-empty")){const s=document.createElement("style");s.id="bjj-css-empty";s.textContent=__css_EmptyState;document.head.appendChild(s);}
function EmptyState({ icon, message = "데이터가 없습니다", plain, className, ...rest }) {
  return (
    <div className={["bjj-empty", plain ? "bjj-empty--plain" : "", className].filter(Boolean).join(" ")} {...rest}>
      <div className="bjj-empty__inner">
        {icon && <div className="bjj-empty__icon">{icon}</div>}
        <p className="bjj-empty__msg">{message}</p>
      </div>
    </div>
  );
}

// ---- forms/Input ----
const __css_Input=`
.bjj-input{height:38px;width:100%;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--card);padding:0 14px;font-size:var(--text-md);font-family:var(--font-sans);color:var(--dark);transition:all var(--duration-feedback) var(--ease-standard);outline:none;box-sizing:border-box;}
.bjj-input::placeholder{color:var(--text-muted);}
.bjj-input:focus-visible{border-color:var(--primary);box-shadow:inset 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);}
.bjj-input:disabled{cursor:not-allowed;opacity:.5;}
.bjj-input--pill{border-radius:var(--radius-pill);}
.bjj-input--error{border-color:var(--destructive);}
.bjj-input--error:focus-visible{border-color:var(--destructive);box-shadow:inset 0 0 0 3px color-mix(in srgb, var(--destructive) 10%, transparent);}
.bjj-input--bare{border:none;background:transparent;height:auto;padding:0;}
.bjj-input--bare:focus-visible{box-shadow:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-input")){const s=document.createElement("style");s.id="bjj-css-input";s.textContent=__css_Input;document.head.appendChild(s);}
function Input({ pill, error, bare, className, ...rest }) {
  const cls = ["bjj-input", pill && "bjj-input--pill", error && "bjj-input--error", bare && "bjj-input--bare", className].filter(Boolean).join(" ");
  return <input className={cls} {...rest} />;
}

// ---- forms/Textarea ----
const __css_Textarea=`
.bjj-textarea{min-height:80px;width:100%;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--card);padding:8px 14px;font-size:var(--text-md);font-family:var(--font-sans);color:var(--dark);transition:all var(--duration-feedback) var(--ease-standard);outline:none;resize:vertical;box-sizing:border-box;}
.bjj-textarea::placeholder{color:var(--text-muted);}
.bjj-textarea:focus-visible{border-color:var(--primary);box-shadow:inset 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);}
.bjj-textarea:disabled{cursor:not-allowed;opacity:.5;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-textarea")){const s=document.createElement("style");s.id="bjj-css-textarea";s.textContent=__css_Textarea;document.head.appendChild(s);}
function Textarea({ className, ...rest }) {
  return <textarea className={["bjj-textarea", className].filter(Boolean).join(" ")} {...rest} />;
}

// ---- forms/Label ----
const __css_Label=`
.bjj-label{font-size:var(--text-md);font-weight:500;color:var(--text);line-height:1;font-family:var(--font-sans);display:inline-flex;align-items:center;gap:4px;}
.bjj-label__req{color:var(--burgundy);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-label")){const s=document.createElement("style");s.id="bjj-css-label";s.textContent=__css_Label;document.head.appendChild(s);}
function Label({ required, children, className, ...rest }) {
  return (
    <label className={["bjj-label", className].filter(Boolean).join(" ")} {...rest}>
      {children}
      {required && <span className="bjj-label__req">*</span>}
    </label>
  );
}

// ---- forms/InputField ----
const __css_InputField=`
.bjj-field{display:flex;flex-direction:column;gap:6px;}
.bjj-field__msg{font-size:var(--text-xs);margin:0;}
.bjj-field__msg--hint{color:var(--text-muted);}
.bjj-field__msg--error{color:var(--destructive);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-field")){const s=document.createElement("style");s.id="bjj-css-field";s.textContent=__css_InputField;document.head.appendChild(s);}
function InputField({ label, required, hint, error, className, style, id, ...inputProps }) {
  const fieldId = id || (label ? "f-" + String(label).replace(/\s+/g, "-") : undefined);
  return (
    <div className={["bjj-field", className].filter(Boolean).join(" ")} style={style}>
      {label && <Label htmlFor={fieldId} required={required}>{label}</Label>}
      <Input id={fieldId} error={!!error} {...inputProps} />
      {error ? <p className="bjj-field__msg bjj-field__msg--error">{error}</p>
        : hint ? <p className="bjj-field__msg bjj-field__msg--hint">{hint}</p> : null}
    </div>
  );
}

// ---- forms/SearchInput ----
const __css_SearchInput=`
.bjj-search{display:flex;align-items:center;gap:12px;border-radius:var(--radius-lg);background:var(--card);padding:12px 20px;box-shadow:var(--shadow-card);border:1px solid var(--border);transition:box-shadow var(--duration-feedback) var(--ease-standard);}
.bjj-search:focus-within{box-shadow:var(--shadow-hover);}
.bjj-search__icon{color:var(--text-muted);flex-shrink:0;display:flex;}
.bjj-search input{border:none;outline:none;background:transparent;flex:1;min-width:0;font-size:var(--text-base);font-family:var(--font-sans);color:var(--dark);padding:0;}
.bjj-search input::placeholder{color:var(--text-muted);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-search")){const s=document.createElement("style");s.id="bjj-css-search";s.textContent=__css_SearchInput;document.head.appendChild(s);}
const SEARCH_SVG = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
function SearchInput({ value, onChange, placeholder = "검색...", trailing, className, style }) {
  return (
    <div className={["bjj-search", className].filter(Boolean).join(" ")} style={style}>
      <span className="bjj-search__icon">{SEARCH_SVG}</span>
      <input value={value} onChange={(e) => onChange && onChange(e.target.value)} placeholder={placeholder} />
      {trailing}
    </div>
  );
}

// ---- forms/Select ----
const __css_Select=`
.bjj-select{position:relative;display:inline-block;font-family:var(--font-sans);}
.bjj-select__trigger{height:38px;min-width:100px;display:inline-flex;align-items:center;justify-content:space-between;gap:8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--card);padding:0 14px;font-size:var(--text-md);color:var(--dark);cursor:pointer;transition:all var(--duration-feedback) var(--ease-standard);outline:none;width:100%;}
.bjj-select__trigger:focus-visible{border-color:var(--primary);box-shadow:inset 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);}
.bjj-select__trigger--placeholder{color:var(--text-muted);}
.bjj-select__chevron{color:var(--text-muted);opacity:.6;flex-shrink:0;transition:transform var(--duration-feedback) var(--ease-standard);}
.bjj-select--open .bjj-select__chevron{transform:rotate(180deg);}
.bjj-select__content{position:absolute;top:calc(100% + 4px);left:0;z-index:var(--z-dropdown);min-width:100%;max-height:240px;overflow-y:auto;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--popover);box-shadow:var(--shadow-popover);padding:6px;animation:bjj-pop-in var(--duration-affordance) var(--ease-entrance);}
@keyframes bjj-pop-in{from{opacity:0;transform:scale(0.96);}to{opacity:1;transform:scale(1);}}
.bjj-select__item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:none;background:transparent;border-radius:var(--radius-md);padding:8px 12px;font-size:var(--text-md);color:var(--dark);cursor:pointer;text-align:left;font-family:var(--font-sans);}
.bjj-select__item:hover{background:var(--surface);}
.bjj-select__item--active{color:var(--primary);font-weight:600;background:var(--primary-light);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-select")){const s=document.createElement("style");s.id="bjj-css-select";s.textContent=__css_Select;document.head.appendChild(s);}
const CHEV = <svg className="bjj-select__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
const CHECK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
function Select({ options = [], value, onChange, placeholder = "선택", className, style }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const active = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={["bjj-select", open ? "bjj-select--open" : "", className].filter(Boolean).join(" ")} style={style}>
      <button type="button" className={"bjj-select__trigger" + (active ? "" : " bjj-select__trigger--placeholder")} onClick={() => setOpen(!open)}>
        <span>{active ? active.label : placeholder}</span>
        {CHEV}
      </button>
      {open && (
        <div className="bjj-select__content">
          {options.map((o) => (
            <button type="button" key={o.value} className={"bjj-select__item" + (o.value === value ? " bjj-select__item--active" : "")}
              onClick={() => { onChange && onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
              {o.value === value && CHECK}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- forms/Checkbox ----
const __css_Checkbox=`
.bjj-checkbox{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-family:var(--font-sans);font-size:var(--text-md);color:var(--text);}
.bjj-checkbox__box{width:16px;height:16px;border-radius:var(--radius-xs);border:1px solid var(--primary);background:var(--card);display:inline-flex;align-items:center;justify-content:center;color:#fff;transition:background var(--duration-affordance) var(--ease-standard);flex-shrink:0;}
.bjj-checkbox__box--checked{background:var(--primary);}
.bjj-checkbox input{position:absolute;opacity:0;pointer-events:none;}
.bjj-checkbox--disabled{cursor:not-allowed;opacity:.5;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-checkbox")){const s=document.createElement("style");s.id="bjj-css-checkbox";s.textContent=__css_Checkbox;document.head.appendChild(s);}
const CB_CHECK = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
function Checkbox({ checked, onChange, label, disabled, className, ...rest }) {
  return (
    <label className={["bjj-checkbox", disabled ? "bjj-checkbox--disabled" : "", className].filter(Boolean).join(" ")}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange && onChange(e.target.checked)} {...rest} />
      <span className={"bjj-checkbox__box" + (checked ? " bjj-checkbox__box--checked" : "")}>{checked && CB_CHECK}</span>
      {label && <span>{label}</span>}
    </label>
  );
}

// ---- forms/RadioGroup ----
const __css_RadioGroup=`
.bjj-radiogroup{display:grid;gap:8px;font-family:var(--font-sans);}
.bjj-radiogroup--row{display:flex;gap:16px;}
.bjj-radio{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:var(--text-md);color:var(--text);}
.bjj-radio__dot{width:16px;height:16px;border-radius:50%;border:1px solid var(--primary);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.bjj-radio__dot::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--primary);transform:scale(0);transition:transform var(--duration-affordance) var(--ease-standard);}
.bjj-radio__dot--checked::after{transform:scale(1);}
.bjj-radio input{position:absolute;opacity:0;pointer-events:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-radio")){const s=document.createElement("style");s.id="bjj-css-radio";s.textContent=__css_RadioGroup;document.head.appendChild(s);}
function RadioGroup({ options = [], value, onChange, row, name, className }) {
  return (
    <div className={["bjj-radiogroup", row ? "bjj-radiogroup--row" : "", className].filter(Boolean).join(" ")} role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className="bjj-radio">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange && onChange(o.value)} />
          <span className={"bjj-radio__dot" + (value === o.value ? " bjj-radio__dot--checked" : "")} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// ---- forms/Switch ----
const __css_Switch=`
.bjj-switch{display:inline-flex;align-items:center;width:42px;height:24px;padding:3px;border-radius:var(--radius-pill);border:none;background:var(--border);cursor:pointer;transition:background var(--duration-feedback) var(--ease-standard);flex-shrink:0;}
.bjj-switch--checked{background:var(--primary);}
.bjj-switch:disabled{cursor:not-allowed;opacity:.55;}
.bjj-switch__thumb{width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:var(--shadow-thumb);transition:transform var(--duration-feedback) var(--ease-standard);transform:translateX(0);}
.bjj-switch--checked .bjj-switch__thumb{transform:translateX(18px);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-switch")){const s=document.createElement("style");s.id="bjj-css-switch";s.textContent=__css_Switch;document.head.appendChild(s);}
function Switch({ checked, onChange, disabled, className, ...rest }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} disabled={disabled}
      className={["bjj-switch", checked ? "bjj-switch--checked" : "", className].filter(Boolean).join(" ")}
      onClick={() => onChange && onChange(!checked)} {...rest}>
      <span className="bjj-switch__thumb" />
    </button>
  );
}

// ---- forms/FormSection ----
const __css_FormSection=`
.bjj-formsection{display:flex;flex-direction:column;gap:12px;}
.bjj-formsection__head{display:flex;align-items:center;gap:8px;}
.bjj-formsection__title{font-size:var(--text-md);font-weight:600;color:var(--primary);margin:0;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-formsection")){const s=document.createElement("style");s.id="bjj-css-formsection";s.textContent=__css_FormSection;document.head.appendChild(s);}
function FormSection({ title, badge, showSeparator, children, className, ...rest }) {
  return (
    <React.Fragment>
      {showSeparator && <Separator style={{ margin: "16px 0" }} />}
      <div className={["bjj-formsection", className].filter(Boolean).join(" ")} {...rest}>
        <div className="bjj-formsection__head">
          <h4 className="bjj-formsection__title">{title}</h4>
          {badge}
        </div>
        {children}
      </div>
    </React.Fragment>
  );
}

// ---- forms/Stepper ----
const __css_Stepper=`
.bjj-stepper{display:flex;align-items:center;font-family:var(--font-sans);}
.bjj-stepper__step{display:flex;flex:1;flex-direction:column;align-items:center;}
.bjj-stepper__circle{border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;}
.bjj-stepper__circle--done,.bjj-stepper__circle--active{background:var(--primary);color:#fff;}
.bjj-stepper__circle--active{box-shadow:0 0 0 1px var(--background),0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent);}
.bjj-stepper__circle--pending{background:var(--surface);color:var(--text-muted);}
.bjj-stepper__label{margin-top:4px;white-space:nowrap;}
.bjj-stepper__label--done{color:var(--primary);}
.bjj-stepper__label--pending{color:var(--text-muted);}
.bjj-stepper__connector{flex-shrink:0;user-select:none;font-weight:600;line-height:1;}
.bjj-stepper__connector--on{color:var(--primary);}
.bjj-stepper__connector--off{color:var(--border);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-stepper")){const s=document.createElement("style");s.id="bjj-css-stepper";s.textContent=__css_Stepper;document.head.appendChild(s);}
const ST_SIZE = {
  sm: { circle: 24, font: "0.55rem", label: "0.5rem", pad: "0 6px", cf: "0.75rem" },
  md: { circle: 32, font: "0.65rem", label: "0.6rem", pad: "0 8px", cf: "0.875rem" },
  lg: { circle: 40, font: "0.75rem", label: "0.7rem", pad: "0 10px", cf: "1rem" },
};
const ST_CHECK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
function Stepper({ steps = [], activeStep = 0, size = "md", showCheckOnDone, className }) {
  const t = ST_SIZE[size] || ST_SIZE.md;
  const stateOf = (i) => (i < activeStep ? "done" : i === activeStep ? "active" : "pending");
  return (
    <div className={["bjj-stepper", className].filter(Boolean).join(" ")}>
      {steps.map((step, i) => {
        const state = stateOf(i);
        const next = i < steps.length - 1 ? stateOf(i + 1) : null;
        return (
          <React.Fragment key={step.label || i}>
            <div className="bjj-stepper__step">
              <div className={"bjj-stepper__circle bjj-stepper__circle--" + state} style={{ width: t.circle, height: t.circle, fontSize: t.font }}>
                {showCheckOnDone && state === "done" ? ST_CHECK : i + 1}
              </div>
              <span className={"bjj-stepper__label bjj-stepper__label--" + (state === "done" ? "done" : "pending")} style={{ fontSize: t.label }}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className={"bjj-stepper__connector bjj-stepper__connector--" + (next === "pending" ? "off" : "on")} style={{ padding: t.pad, fontSize: t.cf, marginTop: -12 }}>-</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---- data/Card ----
const __css_Card=`
.bjj-card{background:var(--card);color:var(--card-foreground);font-family:var(--font-sans);}
.bjj-card--elevated{border-radius:var(--radius-xl);box-shadow:var(--shadow-card);border:none;}
.bjj-card--content{border-radius:var(--radius-lg);box-shadow:var(--shadow-content);border:none;}
.bjj-card--muted{border-radius:var(--radius-lg);background:var(--surface);box-shadow:none;}
.bjj-card--outlined{border-radius:var(--radius-lg);border:1px solid var(--border);box-shadow:none;}
.bjj-card--surface{border-radius:var(--radius-2xl);box-shadow:var(--shadow-card);border:none;}
.bjj-card--hover{transition:transform var(--duration-pop) var(--ease-standard),box-shadow var(--duration-pop) var(--ease-standard);}
.bjj-card--hover:hover{transform:translateY(-4px);box-shadow:var(--shadow-hover);}
.bjj-card--slotted{overflow:hidden;display:flex;flex-direction:column;}
/* Header — title block (title + subtitle, gap 4) left, trailing right */
.bjj-cardhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 20px 0;}
.bjj-cardhead--divided{padding-bottom:16px;border-bottom:1px solid var(--border);}
.bjj-cardhead__group{display:flex;flex-direction:column;gap:4px;min-width:0;}
.bjj-cardhead__title{font-size:var(--text-lg);font-weight:700;color:var(--dark);margin:0;line-height:1.3;}
.bjj-cardhead__subtitle{font-size:var(--text-sm);font-weight:500;color:var(--text-muted);margin:0;line-height:1.5;}
.bjj-cardhead__trailing{flex-shrink:0;display:flex;align-items:center;gap:8px;}
/* Body — default content padding 20, internal grid gap 12 */
.bjj-cardbody{padding:20px;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0;}
.bjj-cardbody--flush{padding:0;}
/* Footer — hairline top, actions right, gap 8 */
.bjj-cardfoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid var(--border);}
.bjj-cardfoot--between{justify-content:space-between;}
/* Mobile density */
.bjj-mobile .bjj-cardhead{padding:16px 16px 0;}
.bjj-mobile .bjj-cardhead--divided{padding-bottom:14px;}
.bjj-mobile .bjj-cardbody{padding:16px;gap:14px;}
.bjj-mobile .bjj-cardfoot{padding:14px 16px;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-card")){const s=document.createElement("style");s.id="bjj-css-card";s.textContent=__css_Card;document.head.appendChild(s);}
function Card({ variant = "elevated", hover, slotted, padding = 24, children, className, style, ...rest }) {
  const usePad = slotted ? undefined : padding;
  return (
    <div className={["bjj-card", "bjj-card--" + variant, hover ? "bjj-card--hover" : "", slotted ? "bjj-card--slotted" : "", className].filter(Boolean).join(" ")}
      style={usePad !== undefined ? { padding: usePad, ...style } : style} {...rest}>
      {children}
    </div>
  );
}
function CardHeader({ title, subtitle, trailing, className, ...rest }) {
  return (
    <div className={["bjj-cardhead", "bjj-cardhead--divided", className].filter(Boolean).join(" ")} {...rest}>
      <div className="bjj-cardhead__group">
        {title != null && <h3 className="bjj-cardhead__title">{title}</h3>}
        {subtitle != null && <p className="bjj-cardhead__subtitle">{subtitle}</p>}
      </div>
      {trailing != null && <div className="bjj-cardhead__trailing">{trailing}</div>}
    </div>
  );
}
function CardBody({ flush, children, className, style, ...rest }) {
  return <div className={["bjj-cardbody", flush ? "bjj-cardbody--flush" : "", className].filter(Boolean).join(" ")} style={style} {...rest}>{children}</div>;
}
function CardFooter({ between, children, className, ...rest }) {
  return <div className={["bjj-cardfoot", between ? "bjj-cardfoot--between" : "", className].filter(Boolean).join(" ")} {...rest}>{children}</div>;
}

// ---- data/ContentCard ----
const __css_ContentCard=`
.bjj-contentcard{display:grid;gap:12px;}
.bjj-contentcard__head{display:grid;gap:3px;}
.bjj-contentcard__titlerow{display:flex;align-items:center;gap:8px;}
.bjj-contentcard__title{margin:0;font-size:var(--text-sm);font-weight:700;line-height:1.3;color:var(--text);}
.bjj-contentcard__title--eyebrow{font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);}
.bjj-contentcard__desc{margin:0;font-size:var(--text-xs);font-weight:600;line-height:1.4;color:var(--text-muted);}
.bjj-contentcard__body{display:grid;gap:14px;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-contentcard")){const s=document.createElement("style");s.id="bjj-css-contentcard";s.textContent=__css_ContentCard;document.head.appendChild(s);}
function ContentCard({ title, description, eyebrow, titleTrailing, variant = "content", children, className, ...rest }) {
  return (
    <Card variant={variant} padding={16} className={["bjj-contentcard", className].filter(Boolean).join(" ")} {...rest}>
      {(title || description) && (
        <div className="bjj-contentcard__head">
          {title && (
            <div className="bjj-contentcard__titlerow">
              <h3 className={"bjj-contentcard__title" + (eyebrow ? " bjj-contentcard__title--eyebrow" : "")}>{title}</h3>
              {titleTrailing}
            </div>
          )}
          {description && <p className="bjj-contentcard__desc">{description}</p>}
        </div>
      )}
      <div className="bjj-contentcard__body">{children}</div>
    </Card>
  );
}

// ---- data/StatMini ----
const __css_StatMini=`
.bjj-statmini{display:flex;flex:1;align-items:center;justify-content:flex-start;gap:16px;border-radius:var(--radius-lg);background:var(--card);padding:16px;box-shadow:var(--shadow-card);transition:transform var(--duration-pop) cubic-bezier(0.33,1,0.68,1),box-shadow var(--duration-pop) cubic-bezier(0.33,1,0.68,1);will-change:transform;animation:bjj-pop-up 0.45s var(--ease-overshoot) both;font-family:var(--font-sans);}
.bjj-statmini:hover{transform:translateY(-6px);box-shadow:var(--shadow-hover);}
.bjj-statmini__icon{width:48px;height:48px;border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bjj-statmini__value{font-size:var(--text-2xl);font-weight:700;color:var(--dark);margin:0;line-height:1.2;}
.bjj-statmini__row{display:flex;align-items:flex-end;gap:8px;}
.bjj-statmini__counter{font-size:var(--text-xs);color:var(--text-muted);margin:0 0 3px;}
.bjj-statmini__label{font-size:var(--text-xs);color:var(--text-muted);margin:0;}
.bjj-accent-0{background:var(--primary-light);color:var(--primary);}
.bjj-accent-1{background:var(--orange-light);color:var(--orange);}
.bjj-accent-2{background:var(--green-light);color:var(--green);}
.bjj-accent-3{background:var(--burgundy-light);color:var(--burgundy);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-statmini")){const s=document.createElement("style");s.id="bjj-css-statmini";s.textContent=__css_StatMini;document.head.appendChild(s);}
function StatMini({ icon, value, label, counter, colorIndex = 0, animationDelay, className, style, ...rest }) {
  return (
    <div className={["bjj-statmini", className].filter(Boolean).join(" ")} style={{ animationDelay, ...style }} {...rest}>
      <div className={"bjj-statmini__icon bjj-accent-" + (colorIndex % 4)}>{icon}</div>
      <div>
        <div className="bjj-statmini__row">
          <p className="bjj-statmini__value">{value}</p>
          {counter && <p className="bjj-statmini__counter">{counter}</p>}
        </div>
        <p className="bjj-statmini__label">{label}</p>
      </div>
    </div>
  );
}

// ---- data/StatsBar ----
function StatsBar({ items = [], columns = 2, className, style }) {
  return (
    <div className={className} style={{ display: "grid", gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))", gap: 16, ...style }}>
      {items.map((item, idx) => (
        <StatMini key={item.label} icon={item.icon} value={item.value} label={item.label} counter={item.counter}
          colorIndex={item.colorIndex ?? idx} animationDelay={(idx * 0.08) + "s"} />
      ))}
    </div>
  );
}

// ---- data/InfoCard ----
const __css_InfoCard=`
.bjj-infocard{background:var(--surface);border-radius:var(--radius-lg);padding:16px;font-family:var(--font-sans);}
.bjj-infocard__title{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);font-weight:600;margin:0 0 12px;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-infocard")){const s=document.createElement("style");s.id="bjj-css-infocard";s.textContent=__css_InfoCard;document.head.appendChild(s);}
function InfoCard({ title, children, className, ...rest }) {
  return (
    <div className={["bjj-infocard", className].filter(Boolean).join(" ")} {...rest}>
      <h3 className="bjj-infocard__title">{title}</h3>
      {children}
    </div>
  );
}

// ---- data/InfoRow ----
const __css_InfoRow=`
.bjj-inforow{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-family:var(--font-sans);}
.bjj-inforow:last-child{border-bottom:none;}
.bjj-inforow__label{font-size:var(--text-md);color:var(--text-muted);}
.bjj-inforow__value{font-size:var(--text-md);font-weight:600;color:var(--dark);text-align:right;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-inforow")){const s=document.createElement("style");s.id="bjj-css-inforow";s.textContent=__css_InfoRow;document.head.appendChild(s);}
function InfoRow({ label, value, className, ...rest }) {
  return (
    <div className={["bjj-inforow", className].filter(Boolean).join(" ")} {...rest}>
      <span className="bjj-inforow__label">{label}</span>
      <span className="bjj-inforow__value">{value ?? "-"}</span>
    </div>
  );
}

// ---- data/Pagination ----
const __css_Pagination=`
.bjj-pagination{display:flex;align-items:center;justify-content:flex-end;gap:16px;padding:8px;font-family:var(--font-sans);}
.bjj-pagination__count{font-size:var(--text-md);color:var(--text-muted);}
.bjj-pagination__btns{display:flex;align-items:center;gap:4px;}
.bjj-pagination__btn{width:32px;height:32px;border-radius:var(--radius-pill);border:none;background:transparent;color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background var(--duration-affordance) var(--ease-standard);}
.bjj-pagination__btn:hover{background:var(--surface);}
.bjj-pagination__btn:disabled{opacity:.5;pointer-events:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-pagination")){const s=document.createElement("style");s.id="bjj-css-pagination";s.textContent=__css_Pagination;document.head.appendChild(s);}
const PG_L = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>;
const PG_R = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;
function Pagination({ count = 0, page = 0, pageSize = 10, onPageChange, className }) {
  const totalPages = Math.ceil(count / pageSize);
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, count);
  return (
    <div className={["bjj-pagination", className].filter(Boolean).join(" ")}>
      <span className="bjj-pagination__count">{count > 0 ? start + "-" + end + " / " + count : "0개"}</span>
      <div className="bjj-pagination__btns">
        <button className="bjj-pagination__btn" disabled={page <= 0} onClick={() => onPageChange && onPageChange(page - 1)} aria-label="이전">{PG_L}</button>
        <button className="bjj-pagination__btn" disabled={page >= totalPages - 1} onClick={() => onPageChange && onPageChange(page + 1)} aria-label="다음">{PG_R}</button>
      </div>
    </div>
  );
}

// ---- data/DataTable ----
const __css_DataTable=`
.bjj-table-wrap{width:100%;overflow-x:auto;font-family:var(--font-sans);}
.bjj-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:var(--text-md);}
.bjj-table th{height:48px;padding:0 8px;text-align:center;vertical-align:middle;font-weight:500;color:var(--muted-foreground);border-bottom:1px solid var(--border);white-space:nowrap;}
.bjj-table td{padding:16px 8px;text-align:center;vertical-align:middle;border-bottom:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted-foreground);}
.bjj-table td:first-child{font-weight:500;color:var(--foreground);}
.bjj-table tbody tr{transition:background var(--duration-feedback) var(--ease-standard);animation:bjj-fade-in 0.4s var(--ease-entrance) both;}
.bjj-table tbody tr:last-child td{border-bottom:none;}
.bjj-table tbody tr.bjj-table__row--click{cursor:pointer;}
.bjj-table tbody tr.bjj-table__row--click:hover{background:color-mix(in srgb, var(--muted) 50%, transparent);}
.bjj-table--left th,.bjj-table--left td{text-align:left;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-table")){const s=document.createElement("style");s.id="bjj-css-table";s.textContent=__css_DataTable;document.head.appendChild(s);}
function DataTable({ columns = [], data = [], rowKey, onRowClick, pageSize = 10, paginate = true, align = "center", emptyMessage = "데이터가 없습니다", className }) {
  const [page, setPage] = React.useState(0);
  const rows = paginate ? data.slice(page * pageSize, (page + 1) * pageSize) : data;
  if (!data.length) return <EmptyState plain message={emptyMessage} />;
  return (
    <div className={["bjj-table-wrap", className].filter(Boolean).join(" ")}>
      <table className={"bjj-table" + (align === "left" ? " bjj-table--left" : "")}>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} style={{ width: c.width }}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i} className={onRowClick ? "bjj-table__row--click" : ""}
              style={{ animationDelay: (150 + i * 30) + "ms" }} onClick={() => onRowClick && onRowClick(row, i)}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row, i) : String(row[c.key] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {paginate && data.length > pageSize && <Pagination count={data.length} page={page} pageSize={pageSize} onPageChange={setPage} />}
    </div>
  );
}

// ---- data/FilterChips ----
const __css_FilterChips=`
.bjj-filterchips{display:flex;flex-wrap:wrap;gap:8px;font-family:var(--font-sans);}
.bjj-filterchips__chip{border-radius:var(--radius-lg);border:none;padding:8px 16px;font-size:var(--text-md);font-weight:500;cursor:pointer;transition:all var(--duration-feedback) var(--ease-standard);background:var(--card);color:var(--text);box-shadow:var(--shadow-card);}
.bjj-filterchips__chip:hover{transform:translateY(-2px);}
.bjj-filterchips__chip--active{background:var(--primary);color:#fff;}
.bjj-filterchips__chip--active:hover{transform:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-filterchips")){const s=document.createElement("style");s.id="bjj-css-filterchips";s.textContent=__css_FilterChips;document.head.appendChild(s);}
function FilterChips({ items = [], activeValue, onChange, className }) {
  return (
    <div className={["bjj-filterchips", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <button key={item.value} type="button"
          className={"bjj-filterchips__chip" + (item.value === activeValue ? " bjj-filterchips__chip--active" : "")}
          onClick={() => onChange && onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ---- data/ActivityTimeline ----
const __css_ActivityTimeline=`
.bjj-timeline{overflow-y:auto;font-family:var(--font-sans);}
.bjj-timeline__item{position:relative;display:flex;gap:12px;padding-bottom:16px;}
.bjj-timeline__line{position:absolute;left:20px;top:40px;bottom:0;width:1px;background:var(--border);}
.bjj-timeline__icon{position:relative;z-index:1;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bjj-timeline__icon--success{background:var(--green-light);color:var(--green);}
.bjj-timeline__icon--warning{background:var(--orange-light);color:var(--orange);}
.bjj-timeline__icon--info{background:var(--primary-light);color:var(--primary);}
.bjj-timeline__icon--danger{background:var(--burgundy-light);color:var(--burgundy);}
.bjj-timeline__body{display:flex;flex-direction:column;justify-content:center;min-width:0;}
.bjj-timeline__text{font-size:var(--text-md);color:var(--text);}
.bjj-timeline__time{font-size:var(--text-2xs);color:var(--text-muted);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-timeline")){const s=document.createElement("style");s.id="bjj-css-timeline";s.textContent=__css_ActivityTimeline;document.head.appendChild(s);}
function ActivityTimeline({ items = [], maxHeight = "400px", className }) {
  return (
    <div className={["bjj-timeline", className].filter(Boolean).join(" ")} style={{ maxHeight }}>
      {items.map((item, i) => (
        <div key={i} className="bjj-timeline__item">
          {i < items.length - 1 && <div className="bjj-timeline__line" />}
          <div className={"bjj-timeline__icon bjj-timeline__icon--" + (item.variant || "info")}>{item.icon}</div>
          <div className="bjj-timeline__body">
            <span className="bjj-timeline__text">{item.text}</span>
            <span className="bjj-timeline__time">{item.time}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- data/Progress ----
const __css_Progress=`
.bjj-progress{position:relative;height:8px;width:100%;overflow:hidden;border-radius:var(--radius-pill);background:color-mix(in srgb, var(--primary) 20%, transparent);}
.bjj-progress__bar{height:100%;background:var(--primary);border-radius:var(--radius-pill);transition:width var(--duration-spatial) var(--ease-standard);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-progress")){const s=document.createElement("style");s.id="bjj-css-progress";s.textContent=__css_Progress;document.head.appendChild(s);}
function Progress({ value = 0, className, ...rest }) {
  return (
    <div className={["bjj-progress", className].filter(Boolean).join(" ")} role="progressbar" aria-valuenow={value} {...rest}>
      <div className="bjj-progress__bar" style={{ width: Math.max(0, Math.min(100, value)) + "%" }} />
    </div>
  );
}

// ---- data/Alert ----
const __css_Alert=`
.bjj-alert{position:relative;width:100%;border-radius:var(--radius-sm);border:1px solid var(--border);padding:12px 16px 12px 44px;font-size:var(--text-md);font-family:var(--font-sans);background:var(--card);color:var(--foreground);box-sizing:border-box;}
.bjj-alert__icon{position:absolute;left:16px;top:13px;display:flex;}
.bjj-alert__title{margin:0 0 4px;font-weight:600;line-height:1;}
.bjj-alert--destructive{border-color:color-mix(in srgb, var(--destructive) 50%, transparent);color:var(--destructive);background:color-mix(in srgb, var(--destructive) 10%, transparent);}
.bjj-alert--success{border-color:color-mix(in srgb, var(--success) 50%, transparent);color:var(--success);background:color-mix(in srgb, var(--success) 10%, transparent);}
.bjj-alert--warning{border-color:color-mix(in srgb, var(--warning-deep) 50%, transparent);color:var(--warning-deep);background:color-mix(in srgb, var(--warning) 10%, transparent);}
.bjj-alert--info{border-color:color-mix(in srgb, var(--info) 50%, transparent);color:var(--info);background:color-mix(in srgb, var(--info) 10%, transparent);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-alert")){const s=document.createElement("style");s.id="bjj-css-alert";s.textContent=__css_Alert;document.head.appendChild(s);}
const AL_ICONS = {
  default: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>,
  destructive: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>,
  success: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>,
  warning: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>,
};
AL_ICONS.info = AL_ICONS.default;
function Alert({ variant = "default", title, children, className, ...rest }) {
  return (
    <div role="alert" className={["bjj-alert", variant !== "default" ? "bjj-alert--" + variant : "", className].filter(Boolean).join(" ")} {...rest}>
      <span className="bjj-alert__icon">{AL_ICONS[variant] || AL_ICONS.default}</span>
      {title && <p className="bjj-alert__title">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

// ---- overlays/Dialog ----
const __css_Dialog=`
.bjj-dialog__overlay{position:fixed;inset:0;z-index:var(--z-scrim);background:rgba(0,0,0,0.5);animation:bjj-fade 0.2s ease-out;}
@keyframes bjj-fade{from{opacity:0;}to{opacity:1;}}
.bjj-dialog{position:fixed;left:50%;top:50%;z-index:var(--z-modal);transform:translate(-50%,-50%);width:calc(100vw - 24px);max-width:480px;max-height:80vh;overflow-y:auto;border-radius:var(--radius-2xl);background:var(--surface);box-shadow:var(--shadow-float);animation:bjj-zoom 0.2s var(--ease-entrance);font-family:var(--font-sans);display:flex;flex-direction:column;}
@keyframes bjj-zoom{from{opacity:0;transform:translate(-50%,-50%) scale(0.95);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}
.bjj-dialog__header{border-bottom:1px solid var(--border);background:var(--card);padding:16px;border-radius:var(--radius-2xl) var(--radius-2xl) 0 0;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.bjj-dialog__title{font-size:1rem;font-weight:700;color:var(--dark);margin:0;}
.bjj-dialog__desc{margin:6px 0 0;font-size:var(--text-sm);line-height:1.6;color:var(--text-muted);}
.bjj-dialog__close{width:32px;height:32px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--text-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:color var(--duration-affordance) var(--ease-standard);flex-shrink:0;}
.bjj-dialog__close:hover{color:var(--dark);}
.bjj-dialog__body{padding:16px;flex:1;}
.bjj-dialog__footer{border-top:1px solid var(--border);background:var(--card);padding:16px;display:flex;justify-content:flex-end;gap:8px;border-radius:0 0 var(--radius-2xl) var(--radius-2xl);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-dialog")){const s=document.createElement("style");s.id="bjj-css-dialog";s.textContent=__css_Dialog;document.head.appendChild(s);}
const DG_X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
function Dialog({ open, onClose, title, description, footer, width = 480, children }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <React.Fragment>
      <div className="bjj-dialog__overlay" onClick={onClose} />
      <div className="bjj-dialog" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        {(title || description) && (
          <div className="bjj-dialog__header">
            <div>
              {title && <h2 className="bjj-dialog__title">{title}</h2>}
              {description && <p className="bjj-dialog__desc">{description}</p>}
            </div>
            {onClose && <button className="bjj-dialog__close" onClick={onClose} aria-label="닫기">{DG_X}</button>}
          </div>
        )}
        <div className="bjj-dialog__body">{children}</div>
        {footer && <div className="bjj-dialog__footer">{footer}</div>}
      </div>
    </React.Fragment>
  );
}

// ---- overlays/ConfirmActionModal ----
const __css_ConfirmActionModal=`
.bjj-confirm{position:fixed;left:50%;top:50%;z-index:var(--z-confirm);transform:translate(-50%,-50%);width:calc(100vw - 40px);max-width:340px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--background);padding:20px;box-shadow:var(--shadow-float);animation:bjj-zoom2 0.2s var(--ease-entrance);font-family:var(--font-sans);display:grid;gap:12px;}
@keyframes bjj-zoom2{from{opacity:0;transform:translate(-50%,-50%) scale(0.95);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}
.bjj-confirm__overlay{position:fixed;inset:0;z-index:var(--z-confirm-scrim);background:rgba(0,0,0,0.5);animation:bjj-fade 0.2s ease-out;}
.bjj-confirm__title{font-size:1rem;font-weight:700;color:var(--dark);margin:0;}
.bjj-confirm__desc{font-size:var(--text-md);line-height:1.6;color:var(--text-muted);margin:6px 0 0;}
.bjj-confirm__actions{display:flex;gap:8px;margin-top:8px;}
.bjj-confirm__actions > *{flex:1;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-confirm")){const s=document.createElement("style");s.id="bjj-css-confirm";s.textContent=__css_ConfirmActionModal;document.head.appendChild(s);}
function ConfirmActionModal({ open, title, description, cancelLabel = "취소", confirmLabel = "확인", confirmVariant = "destructive", onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <React.Fragment>
      <div className="bjj-confirm__overlay" onClick={onCancel} />
      <div className="bjj-confirm" role="alertdialog" aria-modal="true">
        <div>
          <h2 className="bjj-confirm__title">{title}</h2>
          {description && <p className="bjj-confirm__desc">{description}</p>}
        </div>
        <div className="bjj-confirm__actions">
          <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="neutral" onClick={onCancel}>{cancelLabel}</Button>
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- overlays/Tooltip ----
const __css_Tooltip=`
.bjj-tooltip{position:relative;display:inline-flex;}
.bjj-tooltip__content{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:var(--z-tooltip);border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--popover);color:var(--popover-foreground);padding:6px 12px;font-size:var(--text-sm);font-family:var(--font-sans);white-space:nowrap;box-shadow:var(--shadow-popover);animation:bjj-tt 0.15s ease-out;pointer-events:none;}
@keyframes bjj-tt{from{opacity:0;transform:translateX(-50%) scale(0.96);}to{opacity:1;transform:translateX(-50%) scale(1);}}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-tooltip")){const s=document.createElement("style");s.id="bjj-css-tooltip";s.textContent=__css_Tooltip;document.head.appendChild(s);}
function Tooltip({ content, children, className }) {
  const [show, setShow] = React.useState(false);
  return (
    <span className={["bjj-tooltip", className].filter(Boolean).join(" ")}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
      {children}
      {show && <span className="bjj-tooltip__content" role="tooltip">{content}</span>}
    </span>
  );
}

// ---- overlays/DropdownMenu ----
const __css_DropdownMenu=`
.bjj-dropdown{position:relative;display:inline-block;font-family:var(--font-sans);}
.bjj-dropdown__content{position:absolute;top:calc(100% + 8px);right:0;z-index:var(--z-dropdown);min-width:180px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--popover);box-shadow:var(--shadow-popover);padding:6px;animation:bjj-dm 0.15s ease-out;}
.bjj-dropdown__content--left{right:auto;left:0;}
@keyframes bjj-dm{from{opacity:0;transform:scale(0.96);}to{opacity:1;transform:scale(1);}}
.bjj-dropdown__item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:none;background:transparent;border-radius:var(--radius-md);padding:8px 12px;font-size:var(--text-md);color:var(--text);cursor:pointer;text-align:left;font-family:var(--font-sans);transition:background var(--duration-affordance) var(--ease-standard);}
.bjj-dropdown__item:hover{background:var(--surface);color:var(--dark);}
.bjj-dropdown__item--active{color:var(--primary);font-weight:600;background:var(--primary-light);}
.bjj-dropdown__item--danger{color:var(--burgundy);}
.bjj-dropdown__item--danger:hover{background:var(--burgundy-light);color:var(--burgundy);}
.bjj-dropdown__sep{height:1px;background:var(--border);margin:4px -6px;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-dropdown")){const s=document.createElement("style");s.id="bjj-css-dropdown";s.textContent=__css_DropdownMenu;document.head.appendChild(s);}
const DM_CHECK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
function DropdownMenu({ trigger, items = [], activeValue, onSelect, align = "right", className }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className={["bjj-dropdown", className].filter(Boolean).join(" ")}>
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      {open && (
        <div className={"bjj-dropdown__content" + (align === "left" ? " bjj-dropdown__content--left" : "")} role="menu">
          {items.map((item, i) =>
            item === "-" ? <div key={i} className="bjj-dropdown__sep" /> : (
              <button key={item.value ?? i} type="button" role="menuitem"
                className={"bjj-dropdown__item" + (item.value != null && item.value === activeValue ? " bjj-dropdown__item--active" : "") + (item.danger ? " bjj-dropdown__item--danger" : "")}
                onClick={() => { if (item.onClick) item.onClick(); if (onSelect && item.value != null) onSelect(item.value); setOpen(false); }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{item.icon}{item.label}</span>
                {item.value != null && item.value === activeValue && DM_CHECK}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---- navigation/Sidebar ----
const __css_Sidebar=`
.bjj-sidebar{display:flex;flex-direction:column;width:280px;height:100%;background:var(--card);border-radius:0 var(--radius-lg) var(--radius-lg) 0;box-shadow:var(--shadow-card);overflow:hidden;font-family:var(--font-sans);animation:bjj-slide-right 0.4s var(--ease-entrance) both;flex-shrink:0;}
.bjj-sidebar__brand{display:flex;align-items:center;gap:12px;padding:32px 24px 24px;}
.bjj-sidebar__logo{width:48px;height:48px;border-radius:var(--radius-lg);flex-shrink:0;box-shadow:var(--shadow-content);}
.bjj-sidebar__name{font-size:var(--text-xl);font-weight:700;color:var(--dark);letter-spacing:-0.01em;}
.bjj-sidebar__nav{flex:1;overflow-y:auto;padding:8px 16px;display:flex;flex-direction:column;gap:24px;scrollbar-width:none;}
.bjj-sidebar__nav::-webkit-scrollbar{display:none;}
.bjj-sidebar__section-title{padding:0 16px;margin:0 0 8px;font-size:var(--text-2xs);font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.15em;}
.bjj-sidebar__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;}
.bjj-sidebar__item{position:relative;display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:var(--radius-lg);border:none;background:transparent;width:100%;cursor:pointer;transition:background var(--duration-feedback) var(--ease-standard),color var(--duration-feedback) var(--ease-standard);color:var(--text);font-size:var(--text-base);font-weight:500;font-family:var(--font-sans);text-align:left;text-decoration:none;}
.bjj-sidebar__item:hover{background:var(--primary-light);color:var(--primary);}
.bjj-sidebar__item--active{background:var(--primary);color:#fff;box-shadow:0 4px 6px -1px rgba(59,130,246,0.2);}
.bjj-sidebar__item--active:hover{background:var(--primary);color:#fff;}
.bjj-sidebar__item svg{flex-shrink:0;}
.bjj-sidebar__badge{margin-left:auto;font-size:var(--text-2xs);padding:2px 8px;border-radius:var(--radius-pill);background:var(--primary-light);color:var(--primary);font-weight:700;}
.bjj-sidebar__item--active .bjj-sidebar__badge{background:rgba(255,255,255,0.2);color:#fff;}
.bjj-sidebar__profile{padding:16px;margin-top:auto;}
.bjj-sidebar__profile-card{display:flex;align-items:center;gap:12px;padding:12px;border-radius:var(--radius-lg);background:color-mix(in srgb, var(--surface) 50%, transparent);border:1px solid color-mix(in srgb, var(--border) 50%, transparent);cursor:pointer;transition:all var(--duration-feedback) var(--ease-standard);}
.bjj-sidebar__profile-card:hover{background:var(--card);box-shadow:var(--shadow-hover);}
.bjj-sidebar__profile-name{font-size:var(--text-base);font-weight:600;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;}
.bjj-sidebar__profile-role{font-size:var(--text-xs);color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-sidebar")){const s=document.createElement("style");s.id="bjj-css-sidebar";s.textContent=__css_Sidebar;document.head.appendChild(s);}
function Sidebar({ logoSrc, brandName = "아가잼잼 관리자", sections = [], user, onNavigate, className, style }) {
  return (
    <aside className={["bjj-sidebar", className].filter(Boolean).join(" ")} style={style} aria-label="Sidebar Navigation">
      <div className="bjj-sidebar__brand">
        {logoSrc && <img className="bjj-sidebar__logo" src={logoSrc} alt={brandName} />}
        <span className="bjj-sidebar__name">{brandName}</span>
      </div>
      <nav className="bjj-sidebar__nav">
        {sections.map((section) => (
          <div key={section.title}>
            <h3 className="bjj-sidebar__section-title">{section.title}</h3>
            <ul className="bjj-sidebar__list">
              {section.items.map((item) => (
                <li key={item.id || item.label}>
                  <button type="button" className={"bjj-sidebar__item" + (item.active ? " bjj-sidebar__item--active" : "")}
                    onClick={() => { if (item.onClick) item.onClick(); if (onNavigate) onNavigate(item.id ?? item.label); }}>
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge && <span className="bjj-sidebar__badge">{item.badge}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {user && (
        <div className="bjj-sidebar__profile">
          <div className="bjj-sidebar__profile-card">
            <Avatar name={user.name} />
            <div style={{ minWidth: 0 }}>
              <p className="bjj-sidebar__profile-name">{user.name}</p>
              <p className="bjj-sidebar__profile-role">{user.role}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ---- navigation/PageHeader ----
const __css_PageHeader=`
.bjj-pageheader{display:flex;flex-direction:column;gap:16px;animation:bjj-slide-up 0.5s var(--ease-entrance) both;font-family:var(--font-sans);}
@media(min-width:768px){.bjj-pageheader--left{flex-direction:row;align-items:center;justify-content:space-between;}}
.bjj-pageheader--center{align-items:center;text-align:center;}
.bjj-pageheader__title{font-size:var(--text-3xl);font-weight:700;color:var(--dark);display:flex;align-items:center;gap:8px;margin:0;}
.bjj-pageheader__title svg{color:var(--primary);}
.bjj-pageheader__subtitle{color:var(--muted-foreground);margin:4px 0 0;font-size:var(--text-base);}
.bjj-pageheader__actions{display:flex;align-items:center;gap:8px;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-pageheader")){const s=document.createElement("style");s.id="bjj-css-pageheader";s.textContent=__css_PageHeader;document.head.appendChild(s);}
function PageHeader({ title, subtitle, icon, actions, align = "left", className, ...rest }) {
  return (
    <div className={["bjj-pageheader", "bjj-pageheader--" + align, className].filter(Boolean).join(" ")} {...rest}>
      <div>
        <h1 className="bjj-pageheader__title" style={align === "center" ? { justifyContent: "center" } : undefined}>{icon}{title}</h1>
        {subtitle && <p className="bjj-pageheader__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="bjj-pageheader__actions">{actions}</div>}
    </div>
  );
}

// ---- navigation/Tabs ----
const __css_Tabs=`
.bjj-tabs{font-family:var(--font-sans);}
.bjj-tabs--underline{position:relative;display:flex;gap:4px;border-bottom:1px solid var(--border);}
.bjj-tabs--underline .bjj-tabs__tab{position:relative;flex:1;text-align:center;font-size:var(--text-md);padding:0 12px 8px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;transition:color var(--duration-feedback) var(--ease-standard);font-family:var(--font-sans);}
.bjj-tabs--underline .bjj-tabs__tab:hover{color:var(--text);}
.bjj-tabs--underline .bjj-tabs__tab--active{color:var(--primary);font-weight:600;}
.bjj-tabs__indicator{position:absolute;bottom:-1px;left:0;height:2px;width:100%;background:var(--primary);}
.bjj-tabs--underline.bjj-tabs--hug .bjj-tabs__tab{flex:0 0 auto;}
.bjj-tabs--pill{display:inline-flex;height:40px;align-items:center;justify-content:center;border-radius:var(--radius-lg);background:var(--muted);padding:4px;color:var(--muted-foreground);}
.bjj-tabs--pill .bjj-tabs__tab{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;border-radius:var(--radius-md);border:none;background:transparent;padding:6px 12px;font-size:var(--text-md);font-weight:500;color:inherit;cursor:pointer;transition:all var(--duration-feedback) var(--ease-standard);font-family:var(--font-sans);}
.bjj-tabs--pill .bjj-tabs__tab--active{background:var(--card);color:var(--foreground);box-shadow:var(--shadow-content);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-tabs")){const s=document.createElement("style");s.id="bjj-css-tabs";s.textContent=__css_Tabs;document.head.appendChild(s);}
function Tabs({ tabs = [], activeTab, onTabChange, variant = "underline", hug, className }) {
  return (
    <div className={["bjj-tabs", "bjj-tabs--" + variant, hug ? "bjj-tabs--hug" : "", className].filter(Boolean).join(" ")} role="tablist">
      {tabs.map((tab) => (
        <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key}
          className={"bjj-tabs__tab" + (activeTab === tab.key ? " bjj-tabs__tab--active" : "")}
          onClick={() => onTabChange && onTabChange(tab.key)}>
          {tab.label}
          {variant === "underline" && activeTab === tab.key && <span className="bjj-tabs__indicator" />}
        </button>
      ))}
    </div>
  );
}

// ---- navigation/SectionNav ----
const __css_SectionNav=`
.bjj-sectionnav{font-family:var(--font-sans);}
.bjj-sectionnav--vertical{width:220px;flex-shrink:0;display:flex;flex-direction:column;gap:4px;}
.bjj-sectionnav--horizontal{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;}
.bjj-sectionnav--horizontal::-webkit-scrollbar{display:none;}
.bjj-sectionnav__item{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:var(--radius-md);border:none;background:transparent;font-size:var(--text-base);font-weight:500;color:var(--text-muted);cursor:pointer;transition:all var(--duration-feedback) var(--ease-standard);text-align:left;font-family:var(--font-sans);white-space:nowrap;}
.bjj-sectionnav__item:hover{background:var(--surface);}
.bjj-sectionnav__item--active{background:var(--primary-light);color:var(--primary);}
.bjj-sectionnav--horizontal .bjj-sectionnav__item{border-radius:var(--radius-pill);padding:8px 16px;background:var(--surface);}
.bjj-sectionnav--horizontal .bjj-sectionnav__item--active{background:var(--primary-light);color:var(--primary);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-sectionnav")){const s=document.createElement("style");s.id="bjj-css-sectionnav";s.textContent=__css_SectionNav;document.head.appendChild(s);}
function SectionNav({ items = [], activeId, onSelect, orientation = "vertical", footer, className }) {
  return (
    <nav className={["bjj-sectionnav", "bjj-sectionnav--" + orientation, className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <button key={item.id} type="button"
          className={"bjj-sectionnav__item" + (activeId === item.id ? " bjj-sectionnav__item--active" : "")}
          onClick={() => onSelect && onSelect(item.id)}>
          {item.icon}
          {item.label}
        </button>
      ))}
      {footer}
    </nav>
  );
}

// ---- navigation/ListPanel ----
const __css_ListPanel=`
.bjj-listpanel{position:relative;background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);display:flex;flex-direction:column;overflow:hidden;height:100%;min-height:0;font-family:var(--font-sans);}
.bjj-listpanel__header{display:flex;align-items:center;justify-content:space-between;padding:24px;flex-shrink:0;gap:16px;}
.bjj-listpanel__header--withtabs{padding-bottom:0;}
.bjj-listpanel__title{font-size:var(--text-lg);font-weight:700;color:var(--dark);margin:0;}
.bjj-listpanel__subtitle{font-size:var(--text-base);color:var(--text-muted);margin:4px 0 0;}
.bjj-listpanel__tabsrow{display:flex;align-items:center;justify-content:space-between;padding:16px 24px 0;flex-shrink:0;gap:8px;}
.bjj-listpanel__content{position:relative;overflow-y:auto;min-height:0;flex:1;padding:24px;scrollbar-width:none;}
.bjj-listpanel__content::-webkit-scrollbar{display:none;}
.bjj-listpanel__overlay{position:absolute;inset:0;z-index:var(--z-panel-overlay);display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-listpanel")){const s=document.createElement("style");s.id="bjj-css-listpanel";s.textContent=__css_ListPanel;document.head.appendChild(s);}
function ListPanel({ title, subtitle, tabs, activeTab, onTabChange, headerActions, tabsTrailing, isLoading, contentSkeleton, emptyState, contentRef, children, className, style }) {
  const showTabs = tabs && tabs.length > 0;
  return (
    <div className={["bjj-listpanel", className].filter(Boolean).join(" ")} style={style}>
      <div className={"bjj-listpanel__header" + (showTabs ? " bjj-listpanel__header--withtabs" : "")}>
        <div style={{ minWidth: 0 }}>
          <h2 className="bjj-listpanel__title">{title}</h2>
          {subtitle && <p className="bjj-listpanel__subtitle">{subtitle}</p>}
        </div>
        {headerActions && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{headerActions}</div>}
      </div>
      {showTabs && (
        <div className="bjj-listpanel__tabsrow">
          <Tabs hug tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
          {tabsTrailing}
        </div>
      )}
      {emptyState && <div className="bjj-listpanel__overlay">{emptyState}</div>}
      <div className="bjj-listpanel__content" ref={contentRef}>{isLoading && contentSkeleton ? contentSkeleton : children}</div>
    </div>
  );
}

// ---- navigation/DetailPanel ----
const __css_DetailPanel=`
.bjj-detailpanel{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);display:flex;flex-direction:column;gap:16px;overflow:hidden;height:100%;min-height:0;animation:bjj-slide-up 0.5s var(--ease-entrance) both;font-family:var(--font-sans);}
.bjj-detailpanel__header{padding:24px 24px 0;display:flex;align-items:center;justify-content:space-between;gap:16px;}
.bjj-detailpanel__id{display:flex;align-items:center;gap:16px;min-width:0;}
.bjj-detailpanel__titles{min-width:0;display:flex;flex-direction:column;gap:4px;}
.bjj-detailpanel__titlerow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.bjj-detailpanel__title{font-size:var(--text-xl);font-weight:700;color:var(--dark);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bjj-detailpanel__subtitle{font-size:var(--text-base);color:var(--text-muted);margin:0;}
.bjj-detailpanel__section{padding:0 24px;}
.bjj-detailpanel__body{overflow-y:auto;flex:1;min-height:0;padding:0 24px 24px;scrollbar-width:none;}
.bjj-detailpanel__body::-webkit-scrollbar{display:none;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-detailpanel")){const s=document.createElement("style");s.id="bjj-css-detailpanel";s.textContent=__css_DetailPanel;document.head.appendChild(s);}
function DetailPanel({ avatar, title, subtitle, badges, trailing, actions, tabs, children, className, style }) {
  return (
    <div className={["bjj-detailpanel", className].filter(Boolean).join(" ")} style={style}>
      <div className="bjj-detailpanel__header">
        <div className="bjj-detailpanel__id">
          {avatar}
          <div className="bjj-detailpanel__titles">
            <div className="bjj-detailpanel__titlerow">
              <h2 className="bjj-detailpanel__title">{title}</h2>
              {badges}
            </div>
            {subtitle && <p className="bjj-detailpanel__subtitle">{subtitle}</p>}
          </div>
        </div>
        {trailing}
      </div>
      {actions && <div className="bjj-detailpanel__section">{actions}</div>}
      {tabs && <div className="bjj-detailpanel__section">{tabs}</div>}
      <div className="bjj-detailpanel__body">{children}</div>
    </div>
  );
}

// ---- navigation/SplitLayout ----
function SplitLayout({ list, detail, listWidth = 380, gap = 24, className, style }) {
  return (
    <div className={className} style={{ display: "grid", gridTemplateColumns: detail ? listWidth + "px 1fr" : "1fr", gap, height: "100%", minHeight: 0, ...style }}>
      {list}
      {detail}
    </div>
  );
}

// ---- navigation/QuickActionButton ----
const __css_QuickActionButton=`
.bjj-quickaction{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border-radius:var(--radius-lg);border:none;background:transparent;cursor:pointer;transition:transform 0.5s var(--ease-standard),box-shadow 0.5s var(--ease-standard);will-change:transform;text-decoration:none;font-family:var(--font-sans);width:100%;box-sizing:border-box;}
.bjj-quickaction:hover{box-shadow:var(--shadow-hover);transform:translateY(-4px);}
.bjj-quickaction:active{transform:scale(0.95);}
.bjj-quickaction__chip{width:40px;height:40px;border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:center;}
.bjj-quickaction__label{font-size:var(--text-sm);font-weight:700;color:var(--dark);text-align:center;line-height:1.3;word-break:keep-all;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-quickaction")){const s=document.createElement("style");s.id="bjj-css-quickaction";s.textContent=__css_QuickActionButton;document.head.appendChild(s);}
function QuickActionButton({ icon, label, colorIndex = 0, onClick, animationDelay, className }) {
  return (
    <button type="button" className={["bjj-quickaction", animationDelay != null ? "animate-pop-up" : "", className].filter(Boolean).join(" ")}
      style={animationDelay != null ? { animationDelay } : undefined} onClick={onClick}>
      <span className={"bjj-quickaction__chip bjj-accent-" + (colorIndex % 4)}>{icon}</span>
      <span className="bjj-quickaction__label">{label}</span>
    </button>
  );
}

// ---- navigation/ShortcutGrid ----
function ShortcutGrid({ shortcuts = [], title = "바로가기", columns = 4, animationBaseDelay = 0.2, animationStagger = 0.06, className, style }) {
  return (
    <section className={className} style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}>
      {title !== null && <h2 style={{ padding: "0 4px", fontSize: "var(--text-lg)", fontWeight: 800, letterSpacing: "-0.01em", color: "var(--dark)", margin: 0, fontFamily: "var(--font-sans)" }}>{title}</h2>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))", gap: 12 }}>
        {shortcuts.map((s, idx) => (
          <QuickActionButton key={s.label} icon={s.icon} label={s.label} colorIndex={idx}
            onClick={s.onClick} animationDelay={(animationBaseDelay + idx * animationStagger) + "s"} />
        ))}
      </div>
    </section>
  );
}

// ---- navigation/HeaderActionButton ----
const __css_HeaderActionButton=`
.bjj-headeraction{display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:var(--radius-lg);border:none;background:transparent;font-size:var(--text-sm);font-weight:600;cursor:pointer;transition:background var(--duration-feedback) var(--ease-standard);font-family:var(--font-sans);}
.bjj-headeraction--primary{color:var(--primary);}
.bjj-headeraction--primary:hover{background:var(--primary-light);}
.bjj-headeraction--muted{color:var(--text-muted);}
.bjj-headeraction--muted:hover{background:var(--surface);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-headeraction")){const s=document.createElement("style");s.id="bjj-css-headeraction";s.textContent=__css_HeaderActionButton;document.head.appendChild(s);}
function HeaderActionButton({ icon, label, variant = "primary", onClick, className, ...rest }) {
  return (
    <button type="button" className={["bjj-headeraction", "bjj-headeraction--" + variant, className].filter(Boolean).join(" ")} onClick={onClick} {...rest}>
      {icon}
      {label}
    </button>
  );
}

// ---- navigation/DetailActions ----
const __css_DetailActions=`
.bjj-detailactions{display:flex;gap:8px;font-family:var(--font-sans);}
.bjj-detailactions__btn{border-radius:var(--radius-lg);border:none;padding:6px 12px;font-size:var(--text-sm);font-weight:600;cursor:pointer;transition:background var(--duration-feedback) var(--ease-standard);font-family:var(--font-sans);}
.bjj-detailactions__btn:disabled{opacity:.5;pointer-events:none;}
.bjj-detailactions__btn--primary{background:var(--primary);color:#fff;}
.bjj-detailactions__btn--primary:hover{background:var(--primary-hover);}
.bjj-detailactions__btn--default{background:var(--surface);color:var(--text);}
.bjj-detailactions__btn--default:hover{background:var(--border);}
.bjj-detailactions__btn--danger{background:var(--burgundy-light);color:var(--burgundy);}
.bjj-detailactions__btn--danger:hover{background:color-mix(in srgb, var(--burgundy) 10%, transparent);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-detailactions")){const s=document.createElement("style");s.id="bjj-css-detailactions";s.textContent=__css_DetailActions;document.head.appendChild(s);}
function DetailActions({ actions = [], className }) {
  return (
    <div className={["bjj-detailactions", className].filter(Boolean).join(" ")}>
      {actions.map((a) => (
        <button key={a.label} type="button" disabled={a.disabled}
          className={"bjj-detailactions__btn bjj-detailactions__btn--" + (a.variant || "default")}
          onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

/* ---- ListSkeleton ---- */
/** List-row loading skeleton — mirrors the Avatar + two-line + trailing-pill row shape. */
function ListSkeleton({ rows = 4, avatar = true, badge = true, className, style }) {
  return (
    <div className={className} style={{ display: "grid", gap: 16, ...style }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {avatar && <Skeleton width={36} height={36} style={{ borderRadius: "50%", flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
            <Skeleton width={i % 2 ? "45%" : "60%"} height={13} />
            <Skeleton width={i % 2 ? "65%" : "40%"} height={10} />
          </div>
          {badge && <Skeleton width={52} height={20} round style={{ flexShrink: 0 }} />}
        </div>
      ))}
    </div>
  );
}

/* ---- DetailSkeleton ---- */
const __onSurface = { background: "color-mix(in srgb, var(--card) 70%, transparent)" };
/** Detail-panel loading skeleton (ported from repo v3/DetailSkeleton) — header block + InfoCard-shaped sections. */
function DetailSkeleton({
  sections = [{ titleWidth: 90, rows: ["100%", "82%", "64%"] }, { titleWidth: 120, rows: ["100%", "70%"] }],
  headerActions = 0, headerBadge, headerBanner, className, style,
}) {
  return (
    <div className={className} aria-hidden="true"
      style={{ height: "100%", minHeight: 0, overflowY: "auto", background: "var(--card)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-card)", fontFamily: "var(--font-sans)", ...style }}>
      <div style={{ display: "grid", gap: 16, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1, display: "grid", gap: 8 }}>
            <Skeleton width="66%" height={24} />
            <div style={{ display: "flex", gap: 16 }}><Skeleton width={96} height={12} /><Skeleton width={96} height={12} /></div>
          </div>
          {headerBadge && <Skeleton width={64} height={20} round style={{ flexShrink: 0 }} />}
          {headerActions > 0 && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {Array.from({ length: headerActions }).map((_, i) => <Skeleton key={i} width={56} height={32} style={{ borderRadius: "var(--radius-sm)" }} />)}
            </div>
          )}
        </div>
        {headerBanner && <Skeleton height={40} style={{ borderRadius: "var(--radius-md)" }} />}
      </div>
      <div style={{ display: "grid", gap: 20, padding: "0 24px 24px" }}>
        {sections.map((sec, idx) => (
          <div key={idx} style={{ display: "grid", gap: 12, borderRadius: "var(--radius-lg)", background: "var(--surface)", padding: 16 }}>
            {sec.titleWidth && <Skeleton width={sec.titleWidth} height={12} style={__onSurface} />}
            <div style={{ display: "grid", gap: 8 }}>
              {sec.rows.map((w, ri) => <Skeleton key={ri} width={w} height={16} style={__onSurface} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- useListInfiniteScroll ---- */
const LIST_INFINITE_PAGE_SIZE = 6;
/**
 * Teaser -> tap-to-expand -> infinite scroll (ported from repo useListInfiniteScroll).
 * Initial: rows-that-fit + 1 peek row + "탭하여 더보기" button. After first tap: an
 * IntersectionObserver sentinel auto-loads pageSize more each time it enters the viewport.
 * resetKey change (filter/tab) resets to the teaser state.
 */
function useListInfiniteScroll({ resetKey, totalItems, fallbackInitialCount = 6, pageSize = LIST_INFINITE_PAGE_SIZE, rowSelector = "[data-list-row]" }) {
  const clamp = (c) => Math.min(Math.max(c, 0), Math.max(totalItems, 0));
  const [st, setSt] = React.useState({ resetKey, visibleCount: clamp(fallbackInitialCount), hasInteracted: false });
  const scrollContainerRef = React.useRef(null);
  const sentinelRef = React.useRef(null);
  const isReset = st.resetKey !== resetKey;
  const hasInteracted = isReset ? false : st.hasInteracted;
  const visibleCount = isReset ? clamp(fallbackInitialCount) : clamp(st.visibleCount || fallbackInitialCount);
  React.useLayoutEffect(() => {
    if (hasInteracted) return;
    const scroll = scrollContainerRef.current;
    if (!scroll) return;
    const measure = () => {
      const first = scroll.querySelector(rowSelector);
      if (!first || first.offsetHeight <= 0) return;
      const cs = window.getComputedStyle(scroll);
      const gap = parseFloat(cs.rowGap || cs.gap || "0") || 0;
      const usable = scroll.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      const fit = Math.max(1, Math.floor((usable + gap) / (first.offsetHeight + gap)));
      const target = clamp(fit + 1); // +1 peek row, hinting there is more
      setSt((c) => (c.resetKey === resetKey && c.visibleCount === target && !c.hasInteracted) ? c : { resetKey, visibleCount: target, hasInteracted: false });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroll);
    return () => ro.disconnect();
  }, [hasInteracted, resetKey, totalItems, rowSelector]);
  const isInitialLoad = !hasInteracted;
  const hasMore = visibleCount < totalItems;
  const loadMore = React.useCallback(() => {
    setSt((c) => {
      const cur = c.resetKey === resetKey ? clamp(c.visibleCount || fallbackInitialCount) : clamp(fallbackInitialCount);
      return { resetKey, visibleCount: clamp(cur + pageSize), hasInteracted: true };
    });
  }, [resetKey, totalItems, fallbackInitialCount, pageSize]);
  React.useEffect(() => {
    if (!hasMore || isInitialLoad) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver((es) => { if (es[0] && es[0].isIntersecting) loadMore(); }, { root: scrollContainerRef.current, rootMargin: "0px 0px 120px 0px", threshold: 0 });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, isInitialLoad, loadMore]);
  return { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore };
}


/* ---- Toast ---- */
const __css=`
.bjj-toast-host{position:fixed;right:24px;bottom:24px;z-index:var(--z-toast);display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:var(--font-sans);}
.bjj-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;min-width:240px;max-width:400px;background:var(--popover);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-float);padding:10px 14px;font-size:var(--text-md);font-weight:500;color:var(--dark);cursor:pointer;animation:bjj-toast-in 300ms var(--ease-entrance);}
.bjj-toast--leaving{animation:bjj-toast-out 300ms var(--ease-standard) forwards;pointer-events:none;}
@keyframes bjj-toast-in{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
@keyframes bjj-toast-out{from{opacity:1;transform:translateY(0);}to{opacity:0;transform:translateY(8px);}}
@media (prefers-reduced-motion: reduce){.bjj-toast,.bjj-toast--leaving{animation-duration:1ms;}}
.bjj-toast__icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bjj-toast__icon--success{background:var(--green-light);color:var(--green);}
.bjj-toast__icon--danger{background:var(--burgundy-light);color:var(--burgundy);}
.bjj-toast__icon--info{background:var(--primary-light);color:var(--primary);}
.bjj-toast__msg{flex:1;min-width:0;}
.bjj-toast__action{border:none;background:transparent;color:var(--primary);font-weight:700;font-size:var(--text-sm);cursor:pointer;font-family:inherit;padding:4px 8px;border-radius:var(--radius-pill);flex-shrink:0;transition:background var(--duration-affordance) var(--ease-standard);}
.bjj-toast__action:hover{background:var(--primary-light);}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-toast")){const s=document.createElement("style");s.id="bjj-css-toast";s.textContent=__css;document.head.appendChild(s);}
const T_SVG = (d) => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const T_ICONS = {
  success: T_SVG(<path d="M20 6 9 17l-5-5"/>),
  danger: T_SVG(<React.Fragment><path d="M18 6 6 18"/><path d="m6 6 12 12"/></React.Fragment>),
  info: T_SVG(<React.Fragment><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></React.Fragment>),
};
function Toast({ variant = "success", children, actionLabel, onAction, leaving, onDismiss }) {
  return (
    <div className={"bjj-toast" + (leaving ? " bjj-toast--leaving" : "")} onClick={onDismiss} role="status">
      <span className={"bjj-toast__icon bjj-toast__icon--" + variant}>{T_ICONS[variant] || T_ICONS.success}</span>
      <span className="bjj-toast__msg">{children}</span>
      {actionLabel && <button className="bjj-toast__action" onClick={(e) => { e.stopPropagation(); if (onAction) onAction(); if (onDismiss) onDismiss(); }}>{actionLabel}</button>}
    </div>
  );
}
const TOAST_OUT_MS = 300;
/** Toast state. push(message, {variant, actionLabel, onAction, duration}) → id. Auto-dismiss 4s (repo canon), out-animation 300ms. Max 3 stacked. */
function useToasts(duration = 4000) {
  const [toasts, setToasts] = React.useState([]);
  const idRef = React.useRef(0);
  const timersRef = React.useRef({});
  const remove = React.useCallback((id) => {
    const t = timersRef.current[id];
    if (t) { clearTimeout(t.hide); clearTimeout(t.gone); delete timersRef.current[id]; }
    setToasts((l) => l.filter((x) => x.id !== id));
  }, []);
  const dismiss = React.useCallback((id) => {
    const t = timersRef.current[id] || {};
    clearTimeout(t.hide);
    setToasts((l) => l.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    timersRef.current[id] = { gone: setTimeout(() => remove(id), TOAST_OUT_MS) };
  }, [remove]);
  const push = React.useCallback((message, opts = {}) => {
    const id = ++idRef.current;
    setToasts((l) => [...l, { id, message, ...opts }].slice(-3));
    timersRef.current[id] = { hide: setTimeout(() => dismiss(id), opts.duration || duration) };
    return id;
  }, [duration, dismiss]);
  React.useEffect(() => () => { for (const t of Object.values(timersRef.current)) { clearTimeout(t.hide); clearTimeout(t.gone); } }, []);
  return { toasts, push, dismiss };
}
/** Fixed bottom-RIGHT stack (inset 24px) — mount ONCE at the app root. Pass dismiss for click-to-close. */
function ToastHost({ toasts, onDismiss }) {
  return (
    <div className="bjj-toast-host" aria-live="polite">
      {toasts.map((t) => <Toast key={t.id} variant={t.variant} actionLabel={t.actionLabel} onAction={t.onAction} leaving={t.leaving} onDismiss={onDismiss ? () => onDismiss(t.id) : undefined}>{t.message}</Toast>)}
    </div>
  );
}

/* ---- useUiScale ---- */
const UI_SCALE_BASE = { width: 1920, height: 1080 };
const UI_SCALE_MULTIPLIER = 1.1;
/** Pure-CSS scale expression — pre-hydration/SSR safe initial value. */
const UI_SCALE_CSS_VALUE = "calc(min(calc(100vw / 1920px), calc(100vh / 1080px)) * 1.1)";
const UI_SCALE_DPR_EPSILON = 0.001;
/** Numeric scale for a viewport — min(w/1920, h/1080) × 1.1, 4 decimals. */
function getUiScaleForViewport(width, height) {
  return Number((Math.min(width / UI_SCALE_BASE.width, height / UI_SCALE_BASE.height) * UI_SCALE_MULTIPLIER).toFixed(4));
}
/**
 * Viewport-proportional UI scaling (ported from repo useGlintUiScale).
 * Returns { "--ui-scale": value } — spread onto the app root's style; size
 * everything inside as calc(Npx * var(--ui-scale, 1)).
 * Re-measures on resize (rAF-coalesced); a devicePixelRatio change alone
 * (browser zoom) is ignored so ctrl+zoom still works as accessibility zoom.
 */
function useUiScaleStyle(enabled = true) {
  const lastDprRef = React.useRef(null);
  const [scaleValue, setScaleValue] = React.useState(UI_SCALE_CSS_VALUE);
  React.useEffect(() => {
    if (!enabled) return;
    lastDprRef.current = window.devicePixelRatio || 1;
    let raf = 0;
    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const prevDpr = lastDprRef.current || window.devicePixelRatio || 1;
        const curDpr = window.devicePixelRatio || prevDpr;
        if (Math.abs(curDpr - prevDpr) > UI_SCALE_DPR_EPSILON) { lastDprRef.current = curDpr; return; }
        const next = String(getUiScaleForViewport(window.innerWidth, window.innerHeight));
        setScaleValue((cur) => (cur === next ? cur : next));
      });
    };
    update();
    window.addEventListener("resize", update);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", update);
    };
  }, [enabled]);
  const value = enabled ? scaleValue : "1";
  return React.useMemo(() => (enabled ? { "--ui-scale": value } : undefined), [enabled, value]);
}

/* ---- Mobile chrome ---- */
const __css_mheader=`
.bjj-mheader{position:fixed;top:0;left:0;right:0;z-index:var(--z-chrome);display:flex;align-items:center;justify-content:space-between;gap:12px;height:56px;padding:0 16px;background:var(--card);border-radius:0 0 var(--radius-2xl) var(--radius-2xl);box-shadow:var(--shadow-card);font-family:var(--font-sans);box-sizing:border-box;}
.bjj-mheader--inline{position:absolute;}
.bjj-mheader__brand{display:flex;align-items:center;gap:10px;min-width:0;}
.bjj-mheader__logo{width:36px;height:36px;border-radius:var(--radius-md);overflow:hidden;flex-shrink:0;display:block;}
.bjj-mheader__logo img{width:100%;height:100%;object-fit:cover;display:block;}
.bjj-mheader__title{font-size:var(--text-base);font-weight:700;color:var(--primary);white-space:nowrap;}
.bjj-mheader__actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-mheader")){const s=document.createElement("style");s.id="bjj-css-mheader";s.textContent=__css_mheader;document.head.appendChild(s);}
/** Mobile top app chrome (<1024) — replaces Sidebar. 56px, bottom-only 24px radius (repo V3MobileHeader canon). */
function MobileHeader({ logoSrc, title = "아가잼잼", actions, fixed = true, className, style }) {
  return (
    <header className={["bjj-mheader", fixed ? null : "bjj-mheader--inline", className].filter(Boolean).join(" ")} style={style}>
      <div className="bjj-mheader__brand">
        {logoSrc && <span className="bjj-mheader__logo"><img src={logoSrc} alt=""/></span>}
        <span className="bjj-mheader__title">{title}</span>
      </div>
      <div className="bjj-mheader__actions">{actions}</div>
    </header>
  );
}
const __css_mnav=`
.bjj-mnav{position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:var(--z-chrome);display:grid;grid-auto-flow:column;grid-auto-columns:1fr;align-items:end;gap:4px;padding:8px;background:color-mix(in srgb, var(--card) 80%, transparent);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:var(--radius-2xl);box-shadow:var(--shadow-float);font-family:var(--font-sans);box-sizing:border-box;}
.bjj-mnav--inline{position:absolute;}
.bjj-mnav__item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border-radius:var(--radius-lg);border:none;background:transparent;color:var(--text-muted);cursor:pointer;font-family:inherit;transition:background 200ms var(--ease-standard), color 200ms var(--ease-standard);}
.bjj-mnav__item:not(.bjj-mnav__item--active):hover{background:var(--primary-light);color:var(--primary);}
.bjj-mnav__item--active{background:var(--primary);color:#fff;}
.bjj-mnav__item--accent{color:var(--primary);}
.bjj-mnav__item--accent.bjj-mnav__item--active{background:var(--primary-light);color:var(--primary);}
.bjj-mnav__label{font-size:var(--text-2xs);font-weight:500;line-height:1;white-space:nowrap;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-mnav")){const s=document.createElement("style");s.id="bjj-css-mnav";s.textContent=__css_mnav;document.head.appendChild(s);}
/** Floating pill bottom nav (repo MobileBottomNav canon, tokenized): inset 16 + safe-area, blurred card bg, 4-5 tabs, active = solid primary. Icons 20px / strokeWidth 2.5. */
function MobileBottomNav({ items = [], activeId, onNavigate, fixed = true, className, style }) {
  return (
    <nav className={["bjj-mnav", fixed ? null : "bjj-mnav--inline", className].filter(Boolean).join(" ")} style={style}>
      {items.map((it) => {
        const active = it.id === activeId;
        const cls = ["bjj-mnav__item", active ? "bjj-mnav__item--active" : null, it.accent ? "bjj-mnav__item--accent" : null].filter(Boolean).join(" ");
        return (
          <button key={it.id} className={cls} onClick={() => { if (it.onClick) it.onClick(); if (onNavigate) onNavigate(it.id); }} aria-current={active ? "page" : undefined}>
            {it.icon}
            <span className="bjj-mnav__label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
const __css_mstack=`
.bjj-mstack{position:relative;width:100%;height:100%;overflow:hidden;}
.bjj-mstack__pane{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;}
.bjj-mstack__detail{transform:translateX(100%);transition:transform 300ms var(--ease-entrance);background:var(--background);z-index:calc(var(--z-chrome) + 1);}
.bjj-mstack__detail--open{transform:translateX(0);}
@media (prefers-reduced-motion: reduce){.bjj-mstack__detail{transition-duration:1ms;}}
.bjj-mstack__back{display:flex;align-items:center;gap:8px;height:44px;padding:0 10px;border:none;background:transparent;color:var(--dark);font-family:var(--font-sans);font-size:var(--text-base);font-weight:700;cursor:pointer;flex-shrink:0;text-align:left;}
.bjj-mstack__back svg{color:var(--text-muted);flex-shrink:0;}
.bjj-mstack__body{flex:1;min-height:0;overflow-y:auto;}
`;if(typeof document!=="undefined"&&!document.getElementById("bjj-css-mstack")){const s=document.createElement("style");s.id="bjj-css-mstack";s.textContent=__css_mstack;document.head.appendChild(s);}
/** Mobile replacement for SplitLayout: full-width list; detail pushes over the whole screen (300ms ease-entrance), back returns. Keep detail content mounted while closing. */
function MobileStack({ list, detail, detailTitle, open, onBack, className, style }) {
  return (
    <div className={["bjj-mstack", className].filter(Boolean).join(" ")} style={style}>
      <div className="bjj-mstack__pane">{list}</div>
      <div className={"bjj-mstack__pane bjj-mstack__detail" + (open ? " bjj-mstack__detail--open" : "")} aria-hidden={!open}>
        <button className="bjj-mstack__back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          {detailTitle}
        </button>
        <div className="bjj-mstack__body">{detail}</div>
      </div>
    </div>
  );
}
/** viewport < breakpoint (기본 1024) — 모바일 분기 훅 (repo useIsMobile/useBreakpoint 통합 포팅). */
function useIsMobile(breakpoint = 1024) {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const check = () => setMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return mobile;
}

window.BJJ = { CardHeader, CardBody, CardFooter, Button, Badge, StatusBadge, TagPill, Avatar, Skeleton, Spinner, Separator, EmptyState, Input, Textarea, Label, InputField, SearchInput, Select, Checkbox, RadioGroup, Switch, FormSection, Stepper, Card, ContentCard, StatMini, StatsBar, InfoCard, InfoRow, Pagination, DataTable, FilterChips, ActivityTimeline, Progress, Alert, Dialog, ConfirmActionModal, Tooltip, DropdownMenu, Sidebar, PageHeader, Tabs, SectionNav, ListPanel, DetailPanel, SplitLayout, QuickActionButton, ShortcutGrid, HeaderActionButton, DetailActions, ListSkeleton, DetailSkeleton, useListInfiniteScroll, LIST_INFINITE_PAGE_SIZE, Toast, ToastHost, useToasts, useUiScaleStyle, getUiScaleForViewport, UI_SCALE_CSS_VALUE, MobileHeader, MobileBottomNav, MobileStack, useIsMobile };
