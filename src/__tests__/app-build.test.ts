import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const APP_OUTPUT_PATH = path.join(process.cwd(), '.twenty');

describe('app build', () => {
  afterEach(() => {
    fs.rmSync(APP_OUTPUT_PATH, {
      force: true,
      recursive: true,
    });
  });

  it(
    'builds successfully with the Twenty CLI',
    () => {
      expect(() =>
        execFileSync(
          process.execPath,
          ['node_modules/twenty-sdk/dist/cli.cjs', 'build'],
          {
            cwd: process.cwd(),
            stdio: 'pipe',
          },
        ),
      ).not.toThrow();
    },
    30_000,
  );
});
