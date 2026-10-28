import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

it('backup falho é repetido depois da hora inicial e sucesso persiste no restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goodbot-backup-test-'));
  try {
    writeFileSync(
      join(dir, 'date'),
      '#!/bin/sh\ncase "$2" in +%F) echo "$TEST_DATE";; +%H) echo "$TEST_HOUR";; esac\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(dir, 'backup.sh'),
      '#!/bin/sh\necho attempt >> "$BACKUP_DIR/attempts"\n[ "$TEST_FAIL" != 1 ]\n',
    );
    const run = (hour: string, fail = '0', day = '2026-10-28') =>
      execFileSync(
        '/bin/sh',
        [fileURLToPath(new URL('../../../../infra/scripts/backup-loop.sh', import.meta.url))],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            BACKUP_DIR: dir,
            BACKUP_SCRIPT: join(dir, 'backup.sh'),
            BACKUP_RUN_ONCE: '1',
            BACKUP_HOUR: '6',
            TEST_HOUR: hour,
            TEST_FAIL: fail,
            TEST_DATE: day,
          },
        },
      );
    run('05');
    run('06', '1');
    expect(() => readFileSync(join(dir, '.last-success'))).toThrow();
    run('07');
    run('12');
    expect(readFileSync(join(dir, 'attempts'), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readFileSync(join(dir, '.last-success'), 'utf8').trim()).toBe('2026-10-28');
    run('08', '0', '2026-10-29');
    expect(readFileSync(join(dir, 'attempts'), 'utf8').trim().split('\n')).toHaveLength(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
