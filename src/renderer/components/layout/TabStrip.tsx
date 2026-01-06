interface TabStripProps {
    tabs: Array<{ id: string; label: string; description?: string }>;
    activeId: string;
    onSelect: (id: string) => void;
}

export function TabStrip({ tabs, activeId, onSelect }: TabStripProps) {
    return (
        <div className="flex h-12 items-center gap-2 border-b border-slate-900/70 bg-slate-950/60 px-4">
            {tabs.map((tab) => {
                const active = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onSelect(tab.id)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${active
                                ? 'bg-cyan-500/15 text-cyan-100'
                                : 'text-slate-400 hover:text-white hover:bg-slate-900/70'
                            }`}
                    >
                        <span>{tab.label}</span>
                        {tab.description ? (
                            <span className="ml-2 text-[11px] font-normal text-slate-500">{tab.description}</span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
