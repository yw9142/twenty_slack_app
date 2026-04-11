export const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const cleanSlackText = (
  value: string | null | undefined,
  { singleLine = false }: { singleLine?: boolean } = {},
): string => {
  const normalized = (value ?? '')
    .replace(/<@[A-Z0-9]+>/gi, ' ')
    .replace(/<![^>]+>/g, ' ')
    .replace(/^\/[a-z0-9_-]+\s*/i, '')
    .replace(/\u00a0/g, ' ');

  if (singleLine) {
    return normalized.trim().replace(/\s+/g, ' ');
  }

  return normalized
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;

export const uniqueNonEmpty = (values: string[]): string[] =>
  Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );

export const toPlainText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

export const splitFullName = (
  fullName: string,
): { firstName: string; lastName: string } => {
  const normalized = fullName.trim();

  if (!normalized.includes(' ')) {
    return {
      firstName: normalized,
      lastName: '',
    };
  }

  const parts = normalized.split(/\s+/);
  const firstName = parts.shift() ?? normalized;

  return {
    firstName,
    lastName: parts.join(' '),
  };
};

export const toTitleCaseKey = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);
