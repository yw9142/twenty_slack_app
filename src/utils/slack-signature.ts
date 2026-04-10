import { createHmac, timingSafeEqual } from 'crypto';

const toBuffer = (value: string): Buffer => Buffer.from(value, 'utf8');

export const buildSlackSignatureBaseString = (
  timestamp: string,
  rawBody: string,
): string => `v0:${timestamp}:${rawBody}`;

export const buildSlackSignature = (
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): string =>
  `v0=${createHmac('sha256', signingSecret)
    .update(buildSlackSignatureBaseString(timestamp, rawBody))
    .digest('hex')}`;

export const verifySlackSignature = ({
  signingSecret,
  providedSignature,
  timestamp,
  rawBody,
}: {
  signingSecret: string;
  providedSignature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
}): boolean => {
  if (!providedSignature || !timestamp) {
    return false;
  }

  const expectedSignature = buildSlackSignature(
    signingSecret,
    timestamp,
    rawBody,
  );

  const expectedBuffer = toBuffer(expectedSignature);
  const providedBuffer = toBuffer(providedSignature);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
};
