import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 p-8 text-slate-200">
                    <h1 className="text-2xl font-bold text-rose-400">Something went wrong</h1>
                    <pre className="mt-4 max-w-full overflow-auto rounded bg-slate-900 p-4 text-xs text-slate-400">
                        {this.state.error?.toString()}
                    </pre>
                    <button
                        className="mt-6 rounded bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
                        onClick={() => window.location.reload()}
                    >
                        Reload
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
