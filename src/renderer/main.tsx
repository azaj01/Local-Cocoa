import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import log from 'electron-log/renderer';

// Configure electron-log for renderer process
const logLevel = (window.env?.LOG_LEVEL ?? import.meta.env.VITE_LOG_LEVEL ?? 'info').toLowerCase();
log.transports.console.level = logLevel as any;
log.transports.console.format = '[renderer] {m}-{d} {h}:{i}:{s} [{level}] {text}';

// Replace console methods with electron-log to capture all console output
Object.assign(console, log.functions);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);
