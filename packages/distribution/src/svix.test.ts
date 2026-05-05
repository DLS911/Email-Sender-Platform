import { describe, expect, it } from "vitest";
import { computeSvixSignature, verifySvixSignature } from "./svix";

const SECRET = "whsec_dGVzdGluZ3NlY3JldA=="; // base64("testingsecret")

function fixture(rawBody: string, ts?: string) {
  const id = "msg_test_001";
  const timestamp = ts ?? Math.floor(Date.now() / 1000).toString();
  const signature = computeSvixSignature({ id, timestamp, rawBody, signingSecret: SECRET });
  return { id, timestamp, signature, rawBody };
}

describe("verifySvixSignature", () => {
  it("verifies a valid signature", () => {
    const f = fixture('{"event":"email.delivered"}');
    const result = verifySvixSignature({
      id: f.id,
      timestamp: f.timestamp,
      signatureHeader: f.signature,
      rawBody: f.rawBody,
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when the body is tampered", () => {
    const f = fixture('{"event":"email.delivered"}');
    const result = verifySvixSignature({
      id: f.id,
      timestamp: f.timestamp,
      signatureHeader: f.signature,
      rawBody: '{"event":"email.opened"}',
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature mismatch");
  });

  it("rejects when the timestamp is too old", () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 3600).toString();
    const f = fixture('{"x":1}', oldTs);
    const result = verifySvixSignature({
      id: f.id,
      timestamp: f.timestamp,
      signatureHeader: f.signature,
      rawBody: f.rawBody,
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("tolerance");
  });

  it("accepts when injected clock is within tolerance", () => {
    const ts = "1700000000";
    const f = fixture('{"x":1}', ts);
    const result = verifySvixSignature({
      id: f.id,
      timestamp: f.timestamp,
      signatureHeader: f.signature,
      rawBody: f.rawBody,
      signingSecret: SECRET,
      now: 1700000010,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when the signing secret is wrong", () => {
    const f = fixture('{"x":1}');
    const result = verifySvixSignature({
      id: f.id,
      timestamp: f.timestamp,
      signatureHeader: f.signature,
      rawBody: f.rawBody,
      signingSecret: "whsec_d3JvbmdzZWNyZXQ=", // base64("wrongsecret")
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a header with multiple signatures if any match", () => {
    const f = fixture('{"x":1}');
    const result = verifySvixSignature({
      id: f.id,
      timestamp: f.timestamp,
      signatureHeader: `v1,fake1== ${f.signature} v1,fake2==`,
      rawBody: f.rawBody,
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when headers are missing", () => {
    const result = verifySvixSignature({
      id: "",
      timestamp: "",
      signatureHeader: "",
      rawBody: "{}",
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing");
  });

  it("rejects when timestamp is non-numeric", () => {
    const result = verifySvixSignature({
      id: "msg_x",
      timestamp: "not-a-number",
      signatureHeader: "v1,sig==",
      rawBody: "{}",
      signingSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid timestamp");
  });
});
