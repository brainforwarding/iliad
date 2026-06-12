/// <reference types="vite/client" />
/// <reference path="./types/iliad.ts" />

// Build identity injected by the `define` block in vite.config.ts.
declare const __APP_VERSION__: string;
declare const __APP_BUILD_HASH__: string;
declare const __APP_BUILD_DATE__: string;
