import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kv, tasks } from '@core/services/app-db/node/schema';
import { createPmTaskStore, type PmTaskStore } from './ozdash-pm-task-store';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe('PM task store', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let store: PmTaskStore;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    store = createPmTaskStore(fixture.db, logger);
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

  async function storedKeys(): Promise<string[]> {
    const rows = await fixture.db.select({ key: kv.key }).from(kv);
    return rows
      .map((row) => row.key)
      .filter((key) => key.startsWith('ozdash-pm-task:'))
      .map((key) => key.slice('ozdash-pm-task:'.length))
      .sort();
  }

  it('round-trips entries by task id', async () => {
    await store.set('child-1', { id: '123', title: 'Fix login', managerTaskId: 'pm-1' });
    await store.set('child-2', { id: '9' });

    expect(await store.get('child-1')).toEqual({
      id: '123',
      title: 'Fix login',
      managerTaskId: 'pm-1',
    });
    expect(await store.get('nope')).toBeNull();
    expect(await store.getMany(['child-2', 'nope'])).toEqual(new Map([['child-2', { id: '9' }]]));

    await store.delete('child-1');
    expect(await store.get('child-1')).toBeNull();
  });

  it('lists entries with their manager task for the renderer', async () => {
    await store.set('child-1', { id: '123', title: 'Fix login', managerTaskId: 'pm-1' });
    await store.set('child-2', { id: '9', managerTaskId: 'gone' });

    expect(await store.listInfos()).toEqual({
      'child-1': {
        pmTask: { id: '123', title: 'Fix login', managerTaskId: 'pm-1' },
        manager: { taskId: 'pm-1', projectId: 'work', name: 'PM 123' },
      },
      'child-2': { pmTask: { id: '9', managerTaskId: 'gone' }, manager: null },
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
});
