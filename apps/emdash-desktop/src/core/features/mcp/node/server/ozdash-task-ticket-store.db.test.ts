import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kv, tasks } from '@core/services/app-db/node/schema';
import { createTaskTicketStore, type TaskTicketStore } from './ozdash-task-ticket-store';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe('task ticket store', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let store: TaskTicketStore;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    store = createTaskTicketStore(fixture.db, logger);
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('work', 'work')`).run();
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('app', 'app')`).run();
    await fixture.db.insert(tasks).values([
      { id: 'pm-1', projectId: 'work', name: 'PM 123', status: 'in_progress' },
      { id: 'child-1', projectId: 'app', name: 'Child', status: 'in_progress' },
      { id: 'child-2', projectId: 'app', name: 'Child 2', status: 'in_progress' },
    ]);
  });

  afterEach(() => {
    fixture.close();
  });

  async function storedKeys(namespace = 'ozdash-task-ticket'): Promise<string[]> {
    const rows = await fixture.db.select({ key: kv.key }).from(kv);
    return rows
      .map((row) => row.key)
      .filter((key) => key.startsWith(`${namespace}:`))
      .map((key) => key.slice(namespace.length + 1))
      .sort();
  }

  it('round-trips entries by task id', async () => {
    await store.set('child-1', { id: '123', title: 'Fix login', pmSessionId: 'pm-1' });
    await store.set('child-2', { id: '9' });

    expect(await store.get('child-1')).toEqual({
      id: '123',
      title: 'Fix login',
      pmSessionId: 'pm-1',
    });
    expect(await store.get('nope')).toBeNull();
    expect(await store.getMany(['child-2', 'nope'])).toEqual(new Map([['child-2', { id: '9' }]]));

    await store.delete('child-1');
    expect(await store.get('child-1')).toBeNull();
  });

  it('lists entries with their PM session for the renderer', async () => {
    await store.set('child-1', { id: '123', title: 'Fix login', pmSessionId: 'pm-1' });
    await store.set('child-2', { id: '9', pmSessionId: 'gone' });

    expect(await store.listInfos()).toEqual({
      'child-1': {
        ticket: { id: '123', title: 'Fix login', pmSessionId: 'pm-1' },
        pmSession: { taskId: 'pm-1', projectId: 'work', name: 'PM 123' },
      },
      'child-2': { ticket: { id: '9', pmSessionId: 'gone' }, pmSession: null },
    });
  });

  it('prunes entries of deleted tasks once their grace period is over', async () => {
    await store.set('child-1', { id: '1' });
    await store.set('not-yet-created', { id: '2' });
    fixture.sqlite.prepare(`UPDATE tasks SET deleted_at = 'x' WHERE id = 'child-1'`).run();

    // Inside the grace period: hidden, but kept (the task row may still be on its way).
    expect(await store.listInfos()).toEqual({});
    expect(await storedKeys()).toEqual(['child-1', 'not-yet-created']);

    expect(await store.listInfos(Date.now() + 11 * 60 * 1000)).toEqual({});
    expect(await storedKeys()).toEqual([]);
  });

  it('moves old ozdash-pm-task entries to the ticket namespace', async () => {
    const insert = fixture.sqlite.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, 0)`
    );
    insert.run(
      'ozdash-pm-task:child-1',
      JSON.stringify({ id: '123', title: 'Fix login', managerTaskId: 'pm-1', savedAt: 5 })
    );
    insert.run('ozdash-pm-task:child-2', JSON.stringify({ title: 'no id' }));

    expect(await store.migrateLegacyEntries()).toBe(1);
    expect(await store.get('child-1')).toEqual({
      id: '123',
      title: 'Fix login',
      pmSessionId: 'pm-1',
    });
    expect(await storedKeys('ozdash-pm-task')).toEqual([]);
    expect(await storedKeys()).toEqual(['child-1']);
    // Running it again is a no-op.
    expect(await store.migrateLegacyEntries()).toBe(0);
  });
});
