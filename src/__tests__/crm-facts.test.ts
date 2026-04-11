import { describe, expect, it } from 'vitest';

import { extractMeetingFacts } from 'src/utils/crm-facts';
import { extractEntityHints } from 'src/utils/entity-hints';

describe('crm facts extraction', () => {
  it('should extract explicit end-user, contact, and product signals without generic noise', () => {
    const input =
      '오늘 SK하이닉스 데이터플랫폼팀 미팅 완료. 엔드유저는 SK하이닉스이고, 파트너사는 이포즌이다. 이번 기회의 제품은 TIBCO이며, 실시간 데이터 통합과 운영 모니터링 고도화 수요가 확인됐다. 고객 실무 담당자는 김민수 책임이다. 5월 말까지 PoC 가능 여부를 검토하고 다음주 안에 제안 초안을 전달해야 한다.';

    const hints = extractEntityHints(input);
    const facts = extractMeetingFacts(input);

    expect(hints.companies).toContain('SK하이닉스');
    expect(hints.companies).not.toContain('확인됐다.');
    expect(facts.companyName).toBe('SK하이닉스');
    expect(facts.personName).toBe('김민수');
    expect(facts.personTitle).toBe('책임');
    expect(facts.solutionName).toBe('TIBCO');
    expect(facts.vendorName).toBe('TIBCO');
    expect(facts.opportunityName).toContain('SK하이닉스');
    expect(facts.opportunityName).toContain('TIBCO');
    expect(facts.noteTitle).not.toContain('확인됐다.');
    expect(facts.noteTitle).not.toContain('Spotfire');
  });
});
