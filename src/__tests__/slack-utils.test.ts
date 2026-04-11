import { describe, expect, it } from 'vitest';

import {
  buildDedupeKey,
  getSlackVerificationToken,
  parseSlackActionBodyFromRouteBody,
  parseSlackCommandBodyFromRouteBody,
} from 'src/utils/slack';

describe('slack utils', () => {
  it('should parse slash command payloads from route body objects', () => {
    const payload = parseSlackCommandBodyFromRouteBody({
      team_id: 'T1',
      channel_id: 'C1',
      user_id: 'U1',
      text: '이번달 신규 영업기회 알려줘',
      response_url: 'https://hooks.slack.com/commands/1',
      token: 'legacy-token',
    });

    expect(payload.teamId).toBe('T1');
    expect(payload.channelId).toBe('C1');
    expect(payload.userId).toBe('U1');
    expect(payload.text).toContain('이번달');
    expect(payload.token).toBe('legacy-token');
  });

  it('should parse interactivity payloads from route body objects', () => {
    const payload = parseSlackActionBodyFromRouteBody({
      payload: JSON.stringify({
        type: 'block_actions',
        user: { id: 'U1' },
        actions: [{ action_id: 'approve_slack_request', value: 'request-1' }],
      }),
    });

    expect(payload.type).toBe('block_actions');
    expect(payload.user?.id).toBe('U1');
    expect(payload.actions?.[0]?.action_id).toBe('approve_slack_request');
  });

  it('should build a dedupe key from available route hints', () => {
    expect(
      buildDedupeKey({
        sourceType: 'APP_MENTION',
        teamId: 'T1',
        channelId: 'C1',
        messageTs: '1710000000.000100',
      }),
    ).toBe('APP_MENTION:T1:C1:1710000000.000100');
  });

  it('should extract the verification token from interactivity payload strings', () => {
    const token = getSlackVerificationToken(
      'payload=%7B%22token%22%3A%22legacy-token%22%2C%22type%22%3A%22block_actions%22%7D',
    );

    expect(token).toBe('legacy-token');
  });

  it('should extract the verification token from interactivity payload objects', () => {
    const token = getSlackVerificationToken({
      payload: JSON.stringify({
        token: 'legacy-token',
        type: 'block_actions',
      }),
    });

    expect(token).toBe('legacy-token');
  });
});
