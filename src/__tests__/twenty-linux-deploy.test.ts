import {
  createMetadataHeaders,
  formatGraphqlErrors,
  normalizeManifestPaths,
} from '../../scripts/twenty-linux-deploy.mjs';
import { describe, expect, it } from 'vitest';

describe('twenty linux deploy helpers', () => {
  it('normalizes manifest paths to posix separators', () => {
    const normalized = normalizeManifestPaths({
      roles: [
        {
          universalIdentifier: 'b9cc5124-7e61-4020-8ab6-084d5ad060a7',
          permissionFlags: ['APPLICATIONS'],
        },
      ],
      logicFunctions: [
        {
          sourceHandlerPath: 'src\\logic-functions\\demo.ts',
          builtHandlerPath: 'src\\logic-functions\\demo.mjs',
        },
      ],
      frontComponents: [
        {
          sourceComponentPath: 'src\\front-components\\demo.tsx',
          builtComponentPath: 'src\\front-components\\demo.mjs',
        },
      ],
      publicAssets: [
        {
          filePath: 'public\\logo.svg',
        },
      ],
    });

    expect(normalized.logicFunctions[0].sourceHandlerPath).toBe(
      'src/logic-functions/demo.ts',
    );
    expect(normalized.logicFunctions[0].builtHandlerPath).toBe(
      'src/logic-functions/demo.mjs',
    );
    expect(normalized.frontComponents[0].builtComponentPath).toBe(
      'src/front-components/demo.mjs',
    );
    expect(normalized.publicAssets[0].filePath).toBe('public/logo.svg');
    expect(normalized.roles[0].permissionFlags[0]).toMatchObject({
      flag: 'APPLICATIONS',
    });
  });

  it('formats metadata validation details from GraphQL errors', () => {
    const formatted = formatGraphqlErrors([
      {
        message: 'Validation errors occurred while syncing application manifest metadata',
        extensions: {
          code: 'METADATA_VALIDATION_FAILED',
          summary: {
            totalErrors: 1,
          },
          errors: {
            fieldMetadata: [
              {
                flatEntityMinimalInformation: {
                  name: 'sourceType',
                },
                errors: [
                  {
                    code: 'INVALID_FIELD_INPUT',
                    message: 'Option id is required',
                  },
                ],
              },
            ],
          },
        },
      },
    ]);

    expect(formatted).toContain('METADATA_VALIDATION_FAILED');
    expect(formatted).toContain('fieldMetadata: sourceType');
    expect(formatted).toContain('Option id is required');
  });

  it('uses json content type for install mutations only', () => {
    expect(
      createMetadataHeaders({
        apiKey: 'secret',
        body: JSON.stringify({ query: 'mutation {}' }),
      }),
    ).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      Accept: '*/*',
    });

    expect(
      createMetadataHeaders({
        apiKey: 'secret',
        body: new FormData(),
      }),
    ).toEqual({
      Authorization: 'Bearer secret',
      Accept: '*/*',
    });
  });
});
