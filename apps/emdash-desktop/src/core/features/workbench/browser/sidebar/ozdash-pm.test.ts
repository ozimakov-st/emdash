import { describe, expect, it } from 'vitest';
import {
  isPmProject,
  normalizeAbsolutePath,
  resolvePmProjectPath,
  withPmProjectFirst,
} from './ozdash-pm';

const local = (path: string) => ({ data: { type: 'local', path } });
const ssh = (path: string) => ({ data: { type: 'ssh', path } });

describe('resolvePmProjectPath', () => {
  it('defaults to ~/Projects/work under the home directory', () => {
    expect(resolvePmProjectPath({ homeDir: '/Users/oz', pmProjectPathOverride: null })).toBe(
      '/Users/oz/Projects/work'
    );
  });

  it('expands ~ in the override', () => {
    expect(resolvePmProjectPath({ homeDir: '/Users/oz/', pmProjectPathOverride: '~/pm/' })).toBe(
      '/Users/oz/pm'
    );
  });

  it('uses an absolute override as is (normalized)', () => {
    expect(
      resolvePmProjectPath({ homeDir: '/Users/oz', pmProjectPathOverride: '/srv//pm/./x/../' })
    ).toBe('/srv/pm');
  });

  it('ignores a blank override', () => {
    expect(resolvePmProjectPath({ homeDir: '/Users/oz', pmProjectPathOverride: '  ' })).toBe(
      '/Users/oz/Projects/work'
    );
  });

  it('returns null when ~ cannot be expanded', () => {
    expect(resolvePmProjectPath({ homeDir: null, pmProjectPathOverride: null })).toBeNull();
    expect(resolvePmProjectPath(undefined)).toBeNull();
  });
});

describe('isPmProject', () => {
  const pmPath = '/Users/oz/Projects/work';

  it('matches a local project with the same path', () => {
    expect(isPmProject(local('/Users/oz/Projects/work'), pmPath)).toBe(true);
    expect(isPmProject(local('/Users/oz/Projects/work/'), pmPath)).toBe(true);
  });

  it('does not match other paths', () => {
    expect(isPmProject(local('/Users/oz/Projects/work2'), pmPath)).toBe(false);
    expect(isPmProject(local('/Users/oz/Projects/work/sub'), pmPath)).toBe(false);
  });

  it('ignores remote (ssh) projects', () => {
    expect(isPmProject(ssh('/Users/oz/Projects/work'), pmPath)).toBe(false);
  });

  it('is false with no PM path or no project data', () => {
    expect(isPmProject(local('/Users/oz/Projects/work'), null)).toBe(false);
    expect(isPmProject({ data: null }, pmPath)).toBe(false);
    expect(isPmProject(undefined, pmPath)).toBe(false);
  });
});

describe('withPmProjectFirst', () => {
  const pmPath = '/h/Projects/work';

  it('moves the PM project to the front and keeps the rest in order', () => {
    const a = local('/h/a');
    const b = local('/h/b');
    const pm = local('/h/Projects/work');
    expect(withPmProjectFirst([a, pm, b], pmPath)).toEqual([pm, a, b]);
  });

  it('returns the same list when there is no PM project', () => {
    const list = [local('/h/a'), ssh('/h/Projects/work')];
    expect(withPmProjectFirst(list, pmPath)).toBe(list);
  });
});

describe('normalizeAbsolutePath', () => {
  it('handles the root', () => {
    expect(normalizeAbsolutePath('/')).toBe('/');
  });
});
