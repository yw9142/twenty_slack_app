import { describe, expect, it } from 'vitest';

import { buildApprovalReply } from 'src/utils/slack-orchestrator';

describe('slack orchestrator approval reply', () => {
  it('shows the planned writes and opinion before approval', () => {
    const reply = buildApprovalReply({
      slackRequestId: 'request-1',
      draft: {
        summary: 'A은행 관련 반영 초안입니다.',
        confidence: 0.88,
        sourceText: 'A은행 Nutanix 전환 검토',
        actions: [
          {
            kind: 'opportunity',
            operation: 'update',
            lookup: {
              name: 'A은행 기존 VDI 전환',
            },
            data: {
              companyName: 'A은행',
              pointOfContactName: '김민수',
              stage: 'DISCOVERY_POC',
            },
          },
        ],
        warnings: ['금액과 마감일은 아직 비어 있습니다.'],
        review: {
          overview: '기존 기회를 검토했습니다.',
          opinion: '기존 기회 업데이트가 자연스럽습니다.',
          items: [
            {
              kind: 'opportunity',
              decision: 'UPDATE',
              target: 'A은행 기존 VDI 전환',
              matchedRecord: 'A은행 기존 VDI 전환',
              reason: '회사, 담당자, 기회 맥락이 일치합니다.',
              fields: [
                { key: 'companyName', value: 'A은행' },
                { key: 'pointOfContactName', value: '김민수' },
                { key: 'stage', value: 'DISCOVERY_POC' },
              ],
            },
          ],
        },
      },
    });

    expect(reply.text).toContain('A은행 관련 반영 초안');
    expect(reply.blocks).toHaveLength(5);

    const planSection = reply.blocks?.[1] as { text?: { text?: string } };
    const opinionSection = reply.blocks?.[2] as { text?: { text?: string } };

    expect(planSection.text?.text).toContain('반영 계획');
    expect(planSection.text?.text).toContain('기존 레코드 업데이트');
    expect(planSection.text?.text).toContain('companyName: A은행');
    expect(opinionSection.text?.text).toContain('기존 기회 업데이트가 자연스럽습니다.');
  });

  it('renders reuse decisions explicitly when approval review says a record is reused', () => {
    const reply = buildApprovalReply({
      slackRequestId: 'request-2',
      draft: {
        summary: '서광건설엔지니어링 신규 리드 등록 초안입니다.',
        confidence: 0.93,
        sourceText: 'CRM에 신규 리드로 등록해줘',
        actions: [
          {
            kind: 'opportunity',
            operation: 'create',
            data: {
              name: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
            },
          },
        ],
        warnings: [],
        review: {
          overview: '리드 등록 패키지 승인 초안',
          opinion: '회사와 담당자 중복 여부를 확인한 뒤 승인하세요.',
          items: [
            {
              kind: 'company',
              decision: 'SKIP',
              target: '서광건설엔지니어링',
              matchedRecord: '서광건설엔지니어링',
              reason: '기존 회사 레코드를 재사용합니다.',
              fields: [],
            },
            {
              kind: 'person',
              decision: 'SKIP',
              target: '박성훈',
              matchedRecord: '박성훈',
              reason: '기존 담당자 레코드를 재사용합니다.',
              fields: [],
            },
          ],
        },
      },
    });

    const planSection = reply.blocks?.[1] as { text?: { text?: string } };

    expect(planSection.text?.text).toContain('기존 레코드 재사용');
    expect(planSection.text?.text).toContain('기존 회사 레코드를 재사용합니다.');
    expect(planSection.text?.text).toContain('기존 담당자 레코드를 재사용합니다.');
  });
});
