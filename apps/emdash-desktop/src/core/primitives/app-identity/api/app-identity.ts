type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.emdash.canary' : 'com.emdash.oz';
export const PRODUCT_NAME = isCanary ? 'Emdash Canary' : 'OZdash';
export const APP_NAME_LOWER = isCanary ? 'emdash-canary' : 'emdash-oz';
export const LINUX_DESKTOP_ID = isCanary ? 'emdash-canary' : 'EmdashOZ';
export const USER_DATA_DIR_NAME = isDev
  ? 'emdash-oz-dev'
  : isCanary
    ? 'emdash-canary'
    : 'emdash-oz';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'emdash-canary' : 'ozdash';
export const R2_BASE_URL = 'https://releases.emdash.sh';
export const IS_CANARY = isCanary;

// Fork (ozimakov-st): never auto-update; the official release would replace this build.
export const AUTO_UPDATE_DISABLED = true;
