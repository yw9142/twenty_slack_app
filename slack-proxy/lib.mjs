const ROUTE_MAP = {
  '/slack/events': '/s/slack/events',
  '/slack/commands': '/s/slack/commands',
  '/slack/interactivity': '/s/slack/interactivity',
};

const FORWARDED_HEADER_NAMES = [
  'content-type',
  'x-slack-signature',
  'x-slack-request-timestamp',
];

export const normalizeBaseUrl = (value) => value.replace(/\/+$/, '');

export const resolveUpstreamUrl = ({ baseUrl, pathname }) => {
  const targetPath = ROUTE_MAP[pathname];

  if (!targetPath) {
    return null;
  }

  return `${normalizeBaseUrl(baseUrl)}${targetPath}`;
};

export const normalizeSlackStatus = (status) =>
  status >= 200 && status < 300 ? 200 : status;

export const getForwardHeaders = (headers) =>
  FORWARDED_HEADER_NAMES.reduce((result, headerName) => {
    const rawValue = headers[headerName];

    if (rawValue === undefined) {
      return result;
    }

    result[headerName] = Array.isArray(rawValue)
      ? rawValue.join(', ')
      : rawValue;

    return result;
  }, {});
