import { describe, expect, it } from 'vitest';
import {
  isTicketPanelOpen,
  ozdashSidebarMemento,
  ozdashSidebarSchema,
  ozdashTicketPanelMemento,
  ozdashTicketPanelSchema,
  ozdashTicketsBoardMemento,
  ozdashTicketsBoardSchema,
  toggleNavOpen,
  toggleTicketPanelCollapsed,
  toggleTicketPanel,
} from './mementos';

describe('ozdashSidebarMemento', () => {
  it('starts with the "More" group collapsed', () => {
    expect(ozdashSidebarMemento.default.navOpen).toBe(false);
  });

  it('is persisted (survives restarts)', () => {
    expect(ozdashSidebarMemento.retention.tier).toBe('persisted');
  });

  it('toggles open and closed', () => {
    const opened = toggleNavOpen(ozdashSidebarMemento.default);
    expect(opened.navOpen).toBe(true);
    expect(toggleNavOpen(opened).navOpen).toBe(false);
  });

  it('reads back what it stored', () => {
    const stored = ozdashSidebarSchema.serialize(toggleNavOpen(ozdashSidebarMemento.default));
    expect(ozdashSidebarSchema.parseJson(stored)).toEqual({ version: '1', navOpen: true });
  });
});

describe('ozdashTicketsBoardMemento', () => {
  it('starts with Parked open and Archive closed, and is persisted', () => {
    const state = ozdashTicketsBoardMemento.default;
    expect(isTicketPanelOpen(state, 'parked')).toBe(true);
    expect(isTicketPanelOpen(state, 'archive')).toBe(false);
    expect(ozdashTicketsBoardMemento.retention.tier).toBe('persisted');
  });

  it('toggles one panel at a time and reads back what it stored', () => {
    const state = toggleTicketPanel(
      toggleTicketPanel(ozdashTicketsBoardMemento.default, 'archive'),
      'parked'
    );
    expect(state).toEqual({ version: '1', parkedOpen: false, archiveOpen: true });
    expect(ozdashTicketsBoardSchema.parseJson(ozdashTicketsBoardSchema.serialize(state))).toEqual(
      state
    );
  });
});

describe('ozdashTicketPanelMemento', () => {
  it('starts open, is persisted, toggles and reads back', () => {
    expect(ozdashTicketPanelMemento.default.collapsed).toBe(false);
    expect(ozdashTicketPanelMemento.retention.tier).toBe('persisted');
    const collapsed = toggleTicketPanelCollapsed(ozdashTicketPanelMemento.default);
    expect(collapsed.collapsed).toBe(true);
    expect(ozdashTicketPanelSchema.parseJson(ozdashTicketPanelSchema.serialize(collapsed))).toEqual(
      { version: '1', collapsed: true }
    );
  });
});
