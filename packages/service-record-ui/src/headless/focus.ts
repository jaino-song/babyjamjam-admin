export function focusFirstProblem(id: string | null | undefined) {
    if (!id || typeof document === "undefined") return;
    const element = document.getElementById(id);
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
}
