import { homedir } from 'node:os';
import { requestWirePort, type WindowLike } from '@emdash/wire/rpc';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Preload is typechecked by the node program (no DOM lib), but runs in the
// renderer where `window` exists; declare it with the structural type wire needs.
declare const window: WindowLike;

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  requestWirePort: (channel: string) => requestWirePort({ ipcRenderer, window }, { channel }),
  // Boot-watchdog escape hatch. This cannot ride the wire: a hung backend
  // means the wire gateway may never register controllers, so the loading
  // state needs a direct channel to learn the boot is stuck.
  onBootStuck: (callback: (payload: { stuckPhase: string }) => void) => {
    const listener = (_event: unknown, payload: { stuckPhase: string }) => callback(payload);
    ipcRenderer.on('emdash:boot-stuck', listener);
    return () => {
      ipcRenderer.removeListener('emdash:boot-stuck', listener);
    };
  },
  requestBootEscape: (action: 'restart' | 'open-recovery') =>
    ipcRenderer.invoke('emdash:boot-escape', action),
  // Boot report: the splash gate settled, i.e. the usable-workspace moment.
  // The arrival time in main is the measurement.
  reportBootUsable: () => {
    ipcRenderer.send('emdash:boot-usable-workspace');
  },
});

// Fork (ozimakov-st): inputs for the sidebar "PM" project (see ozdash-pm.ts).
contextBridge.exposeInMainWorld('ozdash', {
  homeDir: homedir(),
  pmProjectPathOverride: process.env.OZDASH_PM_PROJECT_PATH ?? null,
  // Task ticket markers (OZDASH_TASK_TICKETS_CHANNEL in mcp/api/ozdash-task-ticket.ts).
  listTaskTickets: () => ipcRenderer.invoke('ozdash:list-task-tickets'),
  // Tickets board (OZDASH_TICKETS_CHANNELS in ozdash/api/tickets.ts).
  listTickets: () => ipcRenderer.invoke('ozdash:list-tickets'),
  onTicketsChanged: (callback: (list: unknown) => void) => {
    const listener = (_event: unknown, list: unknown) => callback(list);
    ipcRenderer.on('ozdash:tickets-changed', listener);
    return () => {
      ipcRenderer.removeListener('ozdash:tickets-changed', listener);
    };
  },
  restoreTicket: (folder: string) => ipcRenderer.invoke('ozdash:restore-ticket', folder),
  openTicketSession: (folder: string, projectId: string) =>
    ipcRenderer.invoke('ozdash:open-ticket-session', folder, projectId),
  linkTicketTask: (input: unknown) => ipcRenderer.invoke('ozdash:link-ticket-task', input),
  createTicket: (input: unknown) => ipcRenderer.invoke('ozdash:create-ticket', input),
  linkPmSession: (input: unknown) => ipcRenderer.invoke('ozdash:link-pm-session', input),
  // OZdash: Dock badge count (OZDASH_ATTENTION_COUNT_CHANNEL in ozdash/api/attention.ts).
  setAttentionCount: (count: number) => ipcRenderer.send('ozdash:attention-count', count),
});
