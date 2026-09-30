import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestPollingTransport } from "@/transport/RestPollingTransport";
import { networkBlock, networkBlockCodeOf } from "./networkBlock";

/**
 * The venue's address blocked by the administrator (2026-10-01): the kiosk
 * must learn it from the server's code and forget it once the server answers.
 */

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("networkBlockCodeOf", () => {
  it("recognises exactly the two block codes on a 403", () => {
    expect(networkBlockCodeOf(403, { code: "ip_blocked" })).toBe("ip_blocked");
    expect(networkBlockCodeOf(403, { code: "country_blocked" })).toBe("country_blocked");
    expect(networkBlockCodeOf(403, { code: "branch_blocked" })).toBeNull();
    expect(networkBlockCodeOf(401, { code: "ip_blocked" })).toBeNull();
    expect(networkBlockCodeOf(403, null)).toBeNull();
  });
});

describe("the transport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    networkBlock.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    networkBlock.clear();
  });

  const poll = async (t: RestPollingTransport) =>
    // The poll loop is private; one iteration is what these tests need.
    (t as unknown as { running: boolean; pollOnce: () => Promise<void> }).pollOnce();

  const transport = () => {
    const t = new RestPollingTransport({ baseUrl: "http://backend.test", pairingToken: "tok" } as never);
    (t as unknown as { running: boolean }).running = true;
    return t;
  };

  it("raises the block from a refused poll and clears it when the server answers again", async () => {
    const t = transport();
    fetchMock.mockImplementation(async () => reply(403, { message: "Your IP is blocked.", code: "ip_blocked" }));
    await poll(t);
    expect(networkBlock.current()).toBe("ip_blocked");
    expect(t.status()).toBe("error");

    fetchMock.mockImplementation(async () => reply(200, { commands: [] }));
    await poll(t);
    expect(networkBlock.current()).toBeNull();
    expect(t.status()).toBe("connected");
    (t as unknown as { running: boolean }).running = false;
  });

  it("any other failure is not a block", async () => {
    const t = transport();
    fetchMock.mockImplementation(async () => reply(500, { message: "Server Error" }));
    await poll(t);
    expect(networkBlock.current()).toBeNull();
    fetchMock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
    await poll(t);
    expect(networkBlock.current()).toBeNull();
    (t as unknown as { running: boolean }).running = false;
  });
});
