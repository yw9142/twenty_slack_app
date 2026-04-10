import { CoreApiClient } from 'twenty-client-sdk/core';

export type GraphQlShape = Record<string, unknown>;

export type UntypedCoreApiClient = {
  query<TResponse extends GraphQlShape>(selection: GraphQlShape): Promise<TResponse>;
  mutation<TResponse extends GraphQlShape>(
    selection: GraphQlShape,
  ): Promise<TResponse>;
};

export const createCoreClient = (): UntypedCoreApiClient =>
  new CoreApiClient() as unknown as UntypedCoreApiClient;
