// OZdash: the macOS Dock badge shows how many tasks need Oleg. The renderer sends
// the count (see ozdash/api/browser/attention.ts); 0 clears the badge.
import { app, ipcMain } from 'electron';
import { OZDASH_ATTENTION_COUNT_CHANNEL, toBadgeCount } from '@core/features/ozdash/api/attention';

function setBadge(count: number): void {
  if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '');
  else app.setBadgeCount(count);
}

/** Listens for attention counts from the renderer. Returns a dispose function. */
export function registerOzdashAttentionBadge(): () => void {
  const onCount = (_event: unknown, value: unknown) => setBadge(toBadgeCount(value));
  ipcMain.on(OZDASH_ATTENTION_COUNT_CHANNEL, onCount);
  return () => {
    ipcMain.removeListener(OZDASH_ATTENTION_COUNT_CHANNEL, onCount);
    setBadge(0);
  };
}
