import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface AppLayoutProps {
    sidebar: ReactNode;
    rightPanel?: ReactNode;
    children: ReactNode;
    className?: string;
}

export function AppLayout({ sidebar, rightPanel, children, className }: AppLayoutProps) {
    return (
        <div className={cn("flex h-screen w-full overflow-hidden bg-background text-foreground", className)}>
            {sidebar}
            <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
                {children}
            </main>
            {rightPanel}
        </div>
    );
}
