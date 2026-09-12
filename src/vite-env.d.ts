/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_MOCK_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.config.ts from package.json — see `define`. */
declare const __APP_VERSION__: string;
