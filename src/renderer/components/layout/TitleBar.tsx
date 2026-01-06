import type { CSSProperties, ReactNode } from 'react';

interface TitleBarProps {
    breadcrumbs?: string[];
    rightSlot?: ReactNode;
}

export function TitleBar({ breadcrumbs = [], rightSlot }: TitleBarProps) {
    const trail = breadcrumbs.length ? breadcrumbs : ['Workspace', 'Dashboard'];
    const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    return (
        <header
            className="flex h-12 items-center justify-between border-b border-slate-900/70 bg-slate-950/90 pl-20 pr-4 text-slate-200"
            style={dragRegionStyle}
        >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.3em]">
                {trail.map((crumb, index) => (
                    <span key={`${crumb}-${index}`} className="flex items-center gap-2" style={noDragStyle}>
                        {index > 0 ? <span className="text-slate-600">/</span> : null}
                        <span className="truncate text-slate-200/90">{crumb}</span>
                    </span>
                ))}
            </div>
            <div className="flex items-center gap-2 text-[11px]" style={noDragStyle}>
                {rightSlot}
            </div>
        </header>
    );
}
