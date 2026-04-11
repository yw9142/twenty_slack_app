# Anthropic Query Pipeline Design

## 문제
- 조회 답변이 규칙 기반 템플릿에 지나치게 의존해서 Sonnet 모델 품질을 거의 활용하지 못했다.
- "상세하게", "하나하나", "요약하지말고" 같은 요청도 월간 건수 요약으로 축약됐다.
- CRM 조회 자체는 안전하게 유지해야 하므로 모델이 GraphQL을 직접 조합하게 두는 방식은 리스크가 크다.

## 목표
- 모델이 조회 의도, 세부도, 기간, 초점 엔터티를 판단하게 한다.
- 앱 코드는 안전한 CRM 조회만 담당한다.
- 최종 Slack 답변은 모델이 실제 CRM 컨텍스트를 기반으로 합성하게 한다.

## 설계
1. 분류 단계
   - Anthropic Messages API의 strict tool use를 사용해 query plan을 구조화한다.
   - plan 필드: `intentType`, `queryCategory`, `detailLevel`, `timeframe`, `focusEntity`, `entityHints`
2. 조회 단계
   - 코드가 분류 결과에 맞는 CRM 데이터를 안전하게 수집한다.
   - 월간 신규, 영업기회 상태, 리스크, 일반 요약에 대해 각기 작은 컨텍스트 객체를 만든다.
3. 답변 단계
   - Anthropic structured outputs를 사용해 Slack reply 섹션을 JSON으로 받는다.
   - 프롬프트에는 XML 태그로 request/classification/crm_context를 분리해서 넣는다.
   - 상세 요청이면 opportunity를 하나씩 열거하도록 강제한다.

## 트레이드오프
- 장점: 모델이 실제 답변 품질을 담당하므로 상세 답변과 의견 품질이 올라간다.
- 장점: CRM 조회는 여전히 코드가 통제해서 SDK 타입 오류와 데이터 오염 리스크를 줄인다.
- 단점: Anthropic 호출이 한 단계 더 추가되어 읽기 응답 지연과 토큰 비용이 늘어난다.
- 단점: LLM 호출 실패 시를 위해 기존 템플릿 fallback을 유지해야 한다.

## 검증
- 상세 조회 요청이 `detailLevel=DETAILED`로 분류되는 테스트
- structured outputs 기반 reply synthesis 테스트
- 전체 test/typecheck/lint/build 통과
