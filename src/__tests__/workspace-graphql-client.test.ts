import { describe, expect, it } from 'vitest';

import { buildWorkspaceGraphqlQueryDocument } from 'src/utils/workspace-graphql-client';

describe('workspace graphql client', () => {
  it('serializes nested selections and arguments into a query document', () => {
    const query = buildWorkspaceGraphqlQueryDocument({
      licenses: {
        __args: {
          paging: {
            first: 5,
          },
        },
        edges: {
          node: {
            id: true,
            name: true,
            vendorCompany: {
              id: true,
              name: true,
            },
          },
        },
      },
    });

    expect(query).toContain('query WorkspaceQuery');
    expect(query).toContain('licenses(paging: { first: 5 })');
    expect(query).toContain('node { id name vendorCompany { id name } }');
  });
});
