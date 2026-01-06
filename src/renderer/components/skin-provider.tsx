import { createContext, useContext, useEffect, useState } from "react";

// Skin types - easily extensible for future skins
export type Skin = "minimalist" | "local-cocoa";

export interface SkinConfig {
    id: Skin;
    name: string;
    description: string;
    preview?: string; // Optional preview image path
}

// Available skins configuration - add new skins here
export const AVAILABLE_SKINS: SkinConfig[] = [
    {
        id: "minimalist",
        name: "Minimalist",
        description: "Clean and minimal design",
    },
    {
        id: "local-cocoa",
        name: "Local Cocoa",
        description: "Warm, cozy cocoa-inspired theme",
    },
];

type SkinProviderProps = {
    children: React.ReactNode;
    defaultSkin?: Skin;
    storageKey?: string;
};

type SkinProviderState = {
    skin: Skin;
    setSkin: (skin: Skin) => void;
    skinConfig: SkinConfig;
};

const initialState: SkinProviderState = {
    skin: "local-cocoa",
    setSkin: () => null,
    skinConfig: AVAILABLE_SKINS[1],
};

const SkinProviderContext = createContext<SkinProviderState>(initialState);

export function SkinProvider({
    children,
    defaultSkin = "local-cocoa",
    storageKey = "local-cocoa-skin",
}: SkinProviderProps) {
    const [skin, setSkinState] = useState<Skin>(
        () => (localStorage.getItem(storageKey) as Skin) || defaultSkin
    );

    useEffect(() => {
        const root = window.document.documentElement;

        // Remove all skin classes
        AVAILABLE_SKINS.forEach((s) => {
            root.classList.remove(`skin-${s.id}`);
        });

        // Add current skin class
        root.classList.add(`skin-${skin}`);
    }, [skin]);

    const setSkin = (newSkin: Skin) => {
        localStorage.setItem(storageKey, newSkin);
        setSkinState(newSkin);
    };

    const skinConfig = AVAILABLE_SKINS.find((s) => s.id === skin) || AVAILABLE_SKINS[0];

    const value: SkinProviderState = {
        skin,
        setSkin,
        skinConfig,
    };

    return (
        <SkinProviderContext.Provider value={value}>
            {children}
        </SkinProviderContext.Provider>
    );
}

export const useSkin = () => {
    const context = useContext(SkinProviderContext);

    if (context === undefined)
        throw new Error("useSkin must be used within a SkinProvider");

    return context;
};

