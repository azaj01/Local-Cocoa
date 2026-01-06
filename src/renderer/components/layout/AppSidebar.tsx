import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface NavItem {
    id: string;
    label: string;
    icon?: ReactNode;
    badge?: string;
}

interface AppSidebarProps {
    items: NavItem[];
    activeId: string;
    onSelect: (id: string) => void;
}

export function AppSidebar({ items, activeId, onSelect }: AppSidebarProps) {
    const [width, setWidth] = useState(260);
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLElement>(null);

    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback(
        (mouseMoveEvent: MouseEvent) => {
            if (isResizing) {
                const newWidth = mouseMoveEvent.clientX;
                if (newWidth > 160 && newWidth < 480) {
                    setWidth(newWidth);
                }
            }
        },
        [isResizing]
    );

    useEffect(() => {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [resize, stopResizing]);

    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
    return (
        <aside
            ref={sidebarRef}
            className="relative flex h-full flex-col border-r border-slate-900/60 bg-slate-950/80 px-3 py-4 text-sm transition-none"
            style={{ width }}
        >
            <div className="mb-6 px-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Workspace</div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
                {items.map((item) => {
                    const active = item.id === activeId;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelect(item.id)}
                            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left transition ${active
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-400 hover:bg-slate-900/70 hover:text-white'
                                }`}
                            style={noDragStyle}
                        >
                            <span className="text-base">{item.icon}</span>
                            <span className="flex-1 truncate text-sm font-medium">{item.label}</span>
                            {item.badge ? (
                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                                    {item.badge}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </nav>
            <div
                className="absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize transition-colors hover:bg-cyan-500/30 active:bg-cyan-500/60"
                onMouseDown={startResizing}
            />
        </aside>
    );
}
