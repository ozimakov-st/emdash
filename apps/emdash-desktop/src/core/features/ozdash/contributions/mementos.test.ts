import { describe, expect, it } from 'vitest';
import {
  isTicketPanelOpen,
  ozdashSidebarFocusMemento,
  ozdashSidebarFocusSchema,
  ozdashSidebarMemento,
  ozdashSidebarSchema,
  ozdashTicketsBoardMemento,
  ozdashTicketSessionsMemento,
  ozdashTicketSessionsSchema,
  ozdashTicketsBoardSchema,
  toggleNavOpen,
  toggleShowAll,
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

describe('ozdashTicketSessionsMemento', () => {
  it('hides archived tasks by default, is persisted and reads back', () => {
    expect(ozdashTicketSessionsMemento.default.showArchived).toBe(false);
    expect(ozdashTicketSessionsMemento.retention.tier).toBe('persisted');
    const stored = ozdashTicketSessionsSchema.serialize({ version: '1', showArchived: true });
    expect(ozdashTicketSessionsSchema.parseJson(stored)).toEqual({
      version: '1',
      showArchived: true,
    });
  });
});

describe('ozdashSidebarFocusMemento', () => {
  it('starts in the Focus view and is persisted', () => {
    expect(ozdashSidebarFocusMemento.default.showAll).toBe(false);
    expect(ozdashSidebarFocusMemento.retention.tier).toBe('persisted');
  });

  it('toggles "show all" and reads back what it stored', () => {
    const shown = toggleShowAll(ozdashSidebarFocusMemento.default);
    expect(shown.showAll).toBe(true);
    expect(toggleShowAll(shown).showAll).toBe(false);
    expect(ozdashSidebarFocusSchema.parseJson(ozdashSidebarFocusSchema.serialize(shown))).toEqual({
      version: '1',
      showAll: true,
    });
  });
});
