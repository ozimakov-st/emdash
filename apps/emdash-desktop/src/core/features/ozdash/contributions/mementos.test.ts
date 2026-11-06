import { describe, expect, it } from 'vitest';
import { ozdashSidebarMemento, ozdashSidebarSchema, toggleNavOpen } from './mementos';

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
