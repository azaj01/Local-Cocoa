import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

interface LoadingDotsProps extends HTMLAttributes<HTMLSpanElement> {
    label?: string;
}

export function LoadingDots({ label, className, ...rest }: LoadingDotsProps) {
    return (
        <span
            className={cn("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary", className)}
            {...rest}
        >
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:240ms]" />
            {label ? <span className="ml-2 text-[10px] normal-case tracking-normal text-muted-foreground">{label}</span> : null}
        </span>
    );
}
