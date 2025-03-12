/// <reference types="vite/client" />

interface ImportMetaEnv {
  VITE_API_URL: string;
  VITE_API_KEY: string;
  VITE_API_MODEL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
