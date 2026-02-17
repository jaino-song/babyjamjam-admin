import { cn } from "@/lib/utils";

interface BlockProps {
    name: string;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

export function Block({ name, className, style, children }: BlockProps) {
    return (
        <div data-component={name} className={cn(className)} style={style}>
            {children}
        </div>
    );
}
