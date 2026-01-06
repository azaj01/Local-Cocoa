import { QuickSearchShell } from './components/QuickSearchShell';
import { MainAppView } from './components/MainAppView';
import { ThemeProvider } from './components/theme-provider';
import { SkinProvider } from './components/skin-provider';

export default function App() {
    const viewParam =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;

    if (viewParam === 'spotlight') {
        return (
            <ThemeProvider defaultTheme="system" storageKey="local-cocoa-theme">
                <SkinProvider defaultSkin="local-cocoa" storageKey="local-cocoa-skin">
                    <QuickSearchShell />
                </SkinProvider>
            </ThemeProvider>
        );
    }

    return (
        <ThemeProvider defaultTheme="system" storageKey="local-cocoa-theme">
            <SkinProvider defaultSkin="local-cocoa" storageKey="local-cocoa-skin">
                <MainAppView />
            </SkinProvider>
        </ThemeProvider>
    );
}
