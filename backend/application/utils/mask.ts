export function maskPhone(value: string | null | undefined): string | null | undefined {
    if (value == null) {
        return value;
    }

    const hyphenatedMatch = value.match(/^(\d{2,3})-(\d{3,4})-(\d{4})$/);
    if (hyphenatedMatch) {
        const prefix = hyphenatedMatch[1] ?? "";
        const middle = hyphenatedMatch[2] ?? "";
        const suffix = hyphenatedMatch[3] ?? "";
        return `${prefix}-${"*".repeat(middle.length)}-${suffix}`;
    }

    const digits = value.replace(/\D/g, "");
    if (digits.length < 10) {
        return value;
    }

    const prefix = digits.slice(0, 3);
    const suffix = digits.slice(-4);
    const middleLength = digits.length - prefix.length - suffix.length;

    if (middleLength <= 0) {
        return value;
    }

    return `${prefix}${"*".repeat(middleLength)}${suffix}`;
}

export function maskEmail(value: string | null | undefined): string | null | undefined {
    if (value == null) {
        return value;
    }

    const atIndex = value.indexOf("@");
    if (atIndex <= 0 || atIndex === value.length - 1) {
        return value;
    }

    return `${value[0]}***${value.slice(atIndex)}`;
}
