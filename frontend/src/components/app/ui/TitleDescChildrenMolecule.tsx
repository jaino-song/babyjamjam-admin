"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TitleDescChildrenMoleculeProps = Omit<React.ComponentPropsWithoutRef<"section">, "title"> & {
    title: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;
    bodyClassName?: string;
    titleClassName?: string;
    descriptionClassName?: string;
};

export function TitleDescChildrenMolecule({
    title,
    description,
    children,
    className,
    bodyClassName,
    titleClassName,
    descriptionClassName,
    ...props
}: TitleDescChildrenMoleculeProps) {
    return (
        <section className={cn("space-y-4", className)} {...props}>
            <div>
                <p
                    className={cn(
                        "text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-v3-primary",
                        titleClassName
                    )}
                >
                    {title}
                </p>
                {description ? (
                    <p
                        className={cn(
                            "mt-1 text-[0.8rem] text-v3-text-muted",
                            descriptionClassName
                        )}
                    >
                        {description}
                    </p>
                ) : null}
            </div>

            <div className={cn("space-y-4", bodyClassName)}>{children}</div>
        </section>
    );
}
