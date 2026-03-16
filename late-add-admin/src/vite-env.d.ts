/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LATE_ADD_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
