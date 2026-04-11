import type { EntityHints } from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import { normalizeText } from 'src/utils/strings';

type CandidateCompany = {
  id: string;
  name: string;
  createdAt?: string | null;
};

type CandidatePerson = {
  id: string;
  fullName: string;
  companyName?: string | null;
  jobTitle?: string | null;
  primaryEmail?: string | null;
};

type CandidateOpportunity = {
  id: string;
  name: string;
  companyName?: string | null;
  pointOfContactName?: string | null;
  stage?: string | null;
  updatedAt?: string | null;
};

export type WriteCandidateContext = {
  companies: CandidateCompany[];
  people: CandidatePerson[];
  opportunities: CandidateOpportunity[];
};

const buildConnectionArgs = (first = 100) => ({
  first,
});

const safeEdges = (
  value: Record<string, unknown> | null | undefined,
): Array<Record<string, unknown>> => {
  if (!value || !Array.isArray(value.edges)) {
    return [];
  }

  return value.edges
    .map((edge) =>
      edge && typeof edge === 'object' && edge.node && typeof edge.node === 'object'
        ? (edge.node as Record<string, unknown>)
        : null,
    )
    .filter((node): node is Record<string, unknown> => node !== null);
};

const toFullName = (
  name: Record<string, unknown> | null | undefined,
): string => {
  if (!name) {
    return '';
  }

  const firstName =
    typeof name.firstName === 'string' ? name.firstName.trim() : '';
  const lastName =
    typeof name.lastName === 'string' ? name.lastName.trim() : '';

  return `${firstName} ${lastName}`.trim();
};

const fetchCandidateCompanies = async (): Promise<CandidateCompany[]> => {
  const client = createCoreClient();
  const response = await client.query<{ companies?: Record<string, unknown> }>({
    companies: {
      __args: buildConnectionArgs(),
      edges: {
        node: {
          id: true,
          name: true,
          createdAt: true,
        },
      },
    },
  });

  return safeEdges(response.companies).map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : '',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
  }));
};

const fetchCandidatePeople = async (): Promise<CandidatePerson[]> => {
  const client = createCoreClient();
  const response = await client.query<{ people?: Record<string, unknown> }>({
    people: {
      __args: buildConnectionArgs(),
      edges: {
        node: {
          id: true,
          name: {
            firstName: true,
            lastName: true,
          },
          company: {
            name: true,
          },
          jobTitle: true,
          emails: {
            primaryEmail: true,
          },
        },
      },
    },
  });

  return safeEdges(response.people).map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    fullName: toFullName(
      record.name && typeof record.name === 'object'
        ? (record.name as Record<string, unknown>)
        : null,
    ),
    companyName:
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as { name?: unknown }).name === 'string'
        ? ((record.company as { name?: string }).name ?? null)
        : null,
    jobTitle: typeof record.jobTitle === 'string' ? record.jobTitle : null,
    primaryEmail:
      record.emails &&
      typeof record.emails === 'object' &&
      typeof (record.emails as { primaryEmail?: unknown }).primaryEmail === 'string'
        ? ((record.emails as { primaryEmail?: string }).primaryEmail ?? null)
        : null,
  }));
};

const fetchCandidateOpportunities = async (): Promise<CandidateOpportunity[]> => {
  const client = createCoreClient();
  const response = await client.query<{ opportunities?: Record<string, unknown> }>({
    opportunities: {
      __args: buildConnectionArgs(),
      edges: {
        node: {
          id: true,
          name: true,
          updatedAt: true,
          stage: true,
          company: {
            name: true,
          },
          pointOfContact: {
            name: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  return safeEdges(response.opportunities).map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    stage: typeof record.stage === 'string' ? record.stage : null,
    companyName:
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as { name?: unknown }).name === 'string'
        ? ((record.company as { name?: string }).name ?? null)
        : null,
    pointOfContactName:
      record.pointOfContact &&
      typeof record.pointOfContact === 'object' &&
      typeof (record.pointOfContact as { name?: unknown }).name === 'object'
        ? toFullName(
            (record.pointOfContact as { name?: Record<string, unknown> }).name,
          ) || null
        : null,
  }));
};

const includesNormalized = (haystack: string, needle: string): boolean => {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);

  return (
    normalizedNeedle.length > 0 &&
    normalizedHaystack.length > 0 &&
    normalizedHaystack.includes(normalizedNeedle)
  );
};

const scoreCompany = (
  company: CandidateCompany,
  text: string,
  hints: EntityHints,
): number => {
  let score = 0;

  if (includesNormalized(text, company.name)) {
    score += 8;
  }

  if (hints.companies.some((hint) => includesNormalized(company.name, hint))) {
    score += 6;
  }

  return score;
};

const scorePerson = (
  person: CandidatePerson,
  text: string,
  hints: EntityHints,
): number => {
  let score = 0;

  if (includesNormalized(text, person.fullName)) {
    score += 8;
  }

  if (person.companyName && includesNormalized(text, person.companyName)) {
    score += 4;
  }

  if (hints.people.some((hint) => includesNormalized(person.fullName, hint))) {
    score += 6;
  }

  return score;
};

const scoreOpportunity = (
  opportunity: CandidateOpportunity,
  text: string,
  hints: EntityHints,
): number => {
  let score = 0;

  if (includesNormalized(text, opportunity.name)) {
    score += 10;
  }

  if (
    opportunity.companyName &&
    (includesNormalized(text, opportunity.companyName) ||
      hints.companies.some((hint) => includesNormalized(opportunity.companyName ?? '', hint)))
  ) {
    score += 6;
  }

  if (
    opportunity.pointOfContactName &&
    (includesNormalized(text, opportunity.pointOfContactName) ||
      hints.people.some((hint) =>
        includesNormalized(opportunity.pointOfContactName ?? '', hint),
      ))
  ) {
    score += 5;
  }

  if (
    hints.opportunities.some((hint) => includesNormalized(opportunity.name, hint))
  ) {
    score += 7;
  }

  return score;
};

const rankCandidates = <TItem>(
  items: TItem[],
  score: (item: TItem) => number,
  limit: number,
): TItem[] =>
  items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);

export const fetchWriteCandidateContext = async ({
  text,
  entityHints,
}: {
  text: string;
  entityHints: EntityHints;
}): Promise<WriteCandidateContext> => {
  const [companies, people, opportunities] = await Promise.all([
    fetchCandidateCompanies(),
    fetchCandidatePeople(),
    fetchCandidateOpportunities(),
  ]);

  return {
    companies: rankCandidates(
      companies,
      (company) => scoreCompany(company, text, entityHints),
      5,
    ),
    people: rankCandidates(
      people,
      (person) => scorePerson(person, text, entityHints),
      5,
    ),
    opportunities: rankCandidates(
      opportunities,
      (opportunity) => scoreOpportunity(opportunity, text, entityHints),
      5,
    ),
  };
};
