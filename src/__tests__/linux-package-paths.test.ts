import { describe, expect, it } from 'vitest';

import { normalizeManifestPaths } from '../../scripts/twenty-linux-deploy.mjs';

describe('normalizeManifestPaths', () => {
  it('converts Windows manifest paths to POSIX paths for Linux installs', () => {
    const manifest = {
      logicFunctions: [
        {
          sourceHandlerPath: 'src\\logic-functions\\build-crm-write-draft.function.ts',
          builtHandlerPath: 'src\\logic-functions\\build-crm-write-draft.function.mjs',
        },
      ],
      frontComponents: [
        {
          sourceComponentPath: 'src\\front-components\\widget.tsx',
          builtComponentPath: 'src\\front-components\\widget.mjs',
        },
      ],
      publicAssets: [
        {
          filePath: 'public\\logo.svg',
        },
      ],
    };

    expect(normalizeManifestPaths(manifest)).toEqual({
      logicFunctions: [
        {
          sourceHandlerPath: 'src/logic-functions/build-crm-write-draft.function.ts',
          builtHandlerPath:
            'src/logic-functions/build-crm-write-draft.function.mjs',
        },
      ],
      frontComponents: [
        {
          sourceComponentPath: 'src/front-components/widget.tsx',
          builtComponentPath: 'src/front-components/widget.mjs',
        },
      ],
      publicAssets: [
        {
          filePath: 'public/logo.svg',
        },
      ],
      roles: [],
    });
  });
});
