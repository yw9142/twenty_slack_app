import { getOptionalEnv } from 'src/utils/env';

export type WorkspaceGraphQlShape = Record<string, unknown>;

type WorkspaceGraphQlClient = {
  query<TResponse extends WorkspaceGraphQlShape>(
    selection: WorkspaceGraphQlShape,
  ): Promise<TResponse>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trimTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const getWorkspaceGraphqlUrl = (): string | null => {
  const baseUrl = getOptionalEnv('TWENTY_BASE_URL');

  if (!baseUrl) {
    return null;
  }

  return `${trimTrailingSlash(baseUrl)}/graphql`;
};

const getWorkspaceApiKey = (): string | null =>
  getOptionalEnv('TWENTY_WORKSPACE_API_KEY') ??
  getOptionalEnv('TWENTY_API_KEY') ??
  null;

export const isWorkspaceGraphqlQueryConfigured = (): boolean =>
  Boolean(getWorkspaceGraphqlUrl() && getWorkspaceApiKey());

const toGraphqlLiteral = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => toGraphqlLiteral(entry)).join(', ')}]`;
  }

  if (isRecord(value)) {
    return `{ ${Object.entries(value)
      .map(([key, entryValue]) => `${key}: ${toGraphqlLiteral(entryValue)}`)
      .join(', ')} }`;
  }

  throw new Error(`Unsupported GraphQL literal value: ${String(value)}`);
};

const buildGraphqlField = (name: string, value: unknown): string => {
  if (value === true) {
    return name;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid GraphQL field selection for "${name}"`);
  }

  const args = isRecord(value.__args) ? value.__args : null;
  const argsText =
    args && Object.keys(args).length > 0
      ? `(${Object.entries(args)
          .map(([key, entryValue]) => `${key}: ${toGraphqlLiteral(entryValue)}`)
          .join(', ')})`
      : '';

  const nestedEntries = Object.entries(value).filter(
    ([key, nestedValue]) => key !== '__args' && nestedValue,
  );

  if (nestedEntries.length === 0) {
    return `${name}${argsText}`;
  }

  return `${name}${argsText} { ${nestedEntries
    .map(([key, nestedValue]) => buildGraphqlField(key, nestedValue))
    .join(' ')} }`;
};

export const buildWorkspaceGraphqlQueryDocument = (
  selection: WorkspaceGraphQlShape,
): string => {
  const fields = Object.entries(selection)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => buildGraphqlField(name, value));

  if (fields.length === 0) {
    throw new Error('Workspace GraphQL query selection must not be empty');
  }

  return `query WorkspaceQuery { ${fields.join(' ')} }`;
};

export const workspaceGraphqlQuery = async <
  TResponse extends WorkspaceGraphQlShape,
>(
  selection: WorkspaceGraphQlShape,
): Promise<TResponse> => {
  const url = getWorkspaceGraphqlUrl();
  const apiKey = getWorkspaceApiKey();

  if (!url || !apiKey) {
    throw new Error(
      'Workspace GraphQL query requires TWENTY_BASE_URL and TWENTY_WORKSPACE_API_KEY',
    );
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: buildWorkspaceGraphqlQueryDocument(selection),
    }),
  });

  if (!response.ok) {
    throw new Error(`Workspace GraphQL query failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: TResponse;
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      payload.errors
        .map((error) => error.message ?? 'Unknown GraphQL error')
        .join('\n'),
    );
  }

  if (!payload.data) {
    throw new Error('Workspace GraphQL query returned no data');
  }

  return payload.data;
};

export const createWorkspaceQueryClient = (): WorkspaceGraphQlClient => ({
  query: workspaceGraphqlQuery,
});
