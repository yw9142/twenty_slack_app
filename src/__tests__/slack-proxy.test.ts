import { describe, expect, it } from 'vitest';

import {
  getForwardHeaders,
  normalizeSlackStatus,
  resolveUpstreamUrl,
} from '../../slack-proxy/lib.mjs';

describe('slack proxy helpers', () => {
  it('maps public Slack routes to Twenty internal routes', () => {
    expect(
      resolveUpstreamUrl({
        baseUrl: 'http://server:3000',
        pathname: '/slack/events',
      }),
    ).toBe('http://server:3000/s/slack/events');

    expect(
      resolveUpstreamUrl({
        baseUrl: 'http://server:3000/',
        pathname: '/slack/commands',
      }),
    ).toBe('http://server:3000/s/slack/commands');
  });

  it('returns null for unsupported routes', () => {
    expect(
      resolveUpstreamUrl({
        baseUrl: 'http://server:3000',
        pathname: '/healthz',
      }),
    ).toBeNull();
  });

  it('normalizes successful upstream responses to 200', () => {
    expect(normalizeSlackStatus(200)).toBe(200);
    expect(normalizeSlackStatus(201)).toBe(200);
    expect(normalizeSlackStatus(204)).toBe(200);
    expect(normalizeSlackStatus(500)).toBe(500);
  });

  it('forwards only the headers the Twenty Slack routes need', () => {
    expect(
      getForwardHeaders({
        'content-type': 'application/json',
        'x-slack-signature': 'v0=abc',
        'x-slack-request-timestamp': '123',
        'user-agent': 'Slackbot',
      }),
    ).toEqual({
      'content-type': 'application/json',
      'x-slack-signature': 'v0=abc',
      'x-slack-request-timestamp': '123',
    });
  });
});
