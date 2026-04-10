export type RichTextValue = {
  markdown: string;
  blocknote: null;
};

export const toRichTextValue = (markdown: string): RichTextValue => ({
  markdown: markdown.trim(),
  blocknote: null,
});

export const getMarkdownText = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const candidate = (value as { markdown?: unknown }).markdown;

  return typeof candidate === 'string' ? candidate : '';
};
