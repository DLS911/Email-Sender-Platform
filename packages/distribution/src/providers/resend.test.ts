import { describe, expect, it } from "vitest";
import { computeSvixSignature } from "../svix";
import { resendProvider } from "./resend";

const SECRET = "whsec_dGVzdGluZ3NlY3JldA==";

function signedHeaders(rawBody: string) {
  const id = "msg_test_001";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = computeSvixSignature({ id, timestamp, rawBody, signingSecret: SECRET });
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}

describe("resendProvider.parseWebhook", () => {
  it("verifies signature and parses a delivered event", async () => {
    const rawBody = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-05-05T10:00:00Z",
      data: { id: "evt-1", to: "alice@example.com" },
    });
    const events = await resendProvider.parseWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      signingSecret: SECRET,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("delivered");
    expect(events[0]?.email).toBe("alice@example.com");
    expect(events[0]?.providerEventId).toBe("evt-1");
  });

  it("maps email.opened to opened", async () => {
    const rawBody = JSON.stringify({
      type: "email.opened",
      created_at: "2026-05-05T10:01:00Z",
      data: { id: "evt-2", to: "alice@example.com" },
    });
    const events = await resendProvider.parseWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      signingSecret: SECRET,
    });
    expect(events[0]?.eventType).toBe("opened");
  });

  it("captures click URL on email.clicked", async () => {
    const rawBody = JSON.stringify({
      type: "email.clicked",
      created_at: "2026-05-05T10:02:00Z",
      data: { id: "evt-3", to: "alice@example.com", url: "https://example.com/article" },
    });
    const events = await resendProvider.parseWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      signingSecret: SECRET,
    });
    expect(events[0]?.eventType).toBe("clicked");
    expect(events[0]?.clickUrl).toBe("https://example.com/article");
  });

  it("captures bounce_type on email.bounced", async () => {
    const rawBody = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-05-05T10:03:00Z",
      data: { id: "evt-4", to: "alice@example.com", bounce_type: "hard" },
    });
    const events = await resendProvider.parseWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      signingSecret: SECRET,
    });
    expect(events[0]?.eventType).toBe("bounced");
    expect(events[0]?.bounceType).toBe("hard");
  });

  it("returns empty array for unknown event types", async () => {
    const rawBody = JSON.stringify({
      type: "email.unknown_event",
      created_at: "2026-05-05T10:04:00Z",
      data: { id: "evt-5" },
    });
    const events = await resendProvider.parseWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      signingSecret: SECRET,
    });
    expect(events).toEqual([]);
  });

  it("throws DistributionError on signature mismatch", async () => {
    const rawBody = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-05-05T10:05:00Z",
      data: { id: "evt-6", to: "alice@example.com" },
    });
    const headers = signedHeaders(rawBody);
    await expect(
      resendProvider.parseWebhook({
        rawBody: '{"tampered":true}',
        headers,
        signingSecret: SECRET,
      }),
    ).rejects.toThrow(/signature/);
  });

  it("throws when signing secret is missing", async () => {
    await expect(
      resendProvider.parseWebhook({
        rawBody: "{}",
        headers: {},
        signingSecret: "",
      }),
    ).rejects.toThrow(/signing secret/);
  });

  it("throws on invalid JSON body", async () => {
    const rawBody = "not json";
    await expect(
      resendProvider.parseWebhook({
        rawBody,
        headers: signedHeaders(rawBody),
        signingSecret: SECRET,
      }),
    ).rejects.toThrow(/json/i);
  });
});
