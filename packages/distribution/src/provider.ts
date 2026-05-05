/**
 * DistributionProvider abstraction. Every send and every webhook event
 * goes through this interface. The Resend adapter is the only v1
 * implementation; SES (and others) follow the same contract.
 *
 * IMPORTANT: only files under `./providers/` may import provider-specific
 * SDKs. Application code uses the abstraction. A lint rule enforces this.
 */

export type SendInput = {
  brandId: string;
  episodeId: string;
  segmentId?: string;
  subscribers: Array<{ id: string; email: string; name?: string }>;
  subjectLine: string;
  preheader?: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  html: string;
  text?: string;
  /** Optional tracking parameters appended to every link for section attribution. */
  trackingParams?: Record<string, string>;
};

export type SendResult = {
  providerName: string;
  providerBroadcastId: string;
  recipientCount: number;
  scheduledAt: string;
};

export type EventType =
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "complained"
  | "bounced"
  | "unsubscribed"
  | "failed";

export type NormalizedEvent = {
  providerName: string;
  providerEventId: string;
  eventType: EventType;
  eventAt: string;
  email: string;
  brandId?: string;
  sendId?: string;
  clickUrl?: string;
  bounceType?: "hard" | "soft";
  replyContent?: string;
  userAgent?: string;
  rawPayload: unknown;
};

export type DistributionProvider = {
  name: string;
  send(input: SendInput): Promise<SendResult>;
  /**
   * Parse an incoming webhook payload + signature into normalized events.
   * Throws if the signature fails verification.
   */
  parseWebhook(args: {
    rawBody: string;
    headers: Record<string, string>;
    signingSecret: string;
  }): Promise<NormalizedEvent[]>;
};
