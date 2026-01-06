interface ImportMetaEnv {
    readonly VITE_DEV_SERVER_URL: string;
    readonly LOG_LEVEL: string;
    // more env variables...
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare global {
    interface Window {
        env: {
            LOG_LEVEL?: string;
            APP_VERSION?: string;
            APP_NAME?: string;
            [key: string]: any;
        };
    }
}

export { };
