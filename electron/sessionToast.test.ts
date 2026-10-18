import { describe, expect, it } from "vitest";
import { PLAYER_TOAST_LANG, TOAST_MS, toastHtml, toastText, validMinutes } from "./sessionToast";
import { TOAST_LOGO_DATA_URI } from "./toastLogo";

/** The player-facing "session ends soon" text and page (2026-10-12). */
describe("sessionToast", () => {
  it("stays 10 seconds", () => {
    expect(TOAST_MS).toBe(10_000);
  });

  it("takes only a whole number of minutes 1..60", () => {
    expect(validMinutes(15)).toBe(15);
    for (const bad of [0, 61, 1.5, "15", null, undefined, NaN, {}]) expect(validMinutes(bad)).toBeNull();
  });

  it("speaks Armenian to the player, whatever the PC's language", () => {
    expect(PLAYER_TOAST_LANG).toBe("am");
    expect(toastHtml(15, PLAYER_TOAST_LANG, TOAST_LOGO_DATA_URI)).toContain("Մինչև խաղային սեսիայի ավարտը մնացել է 15\u00a0րոպե։");
  });

  it("says it in each language, with Russian plurals", () => {
    expect(toastText(15, "ru")).toBe("До окончания игровой сессии осталось 15 минут.");
    expect(toastText(1, "ru")).toBe("До окончания игровой сессии осталось 1 минута.");
    expect(toastText(3, "ru")).toBe("До окончания игровой сессии осталось 3 минуты.");
    expect(toastText(11, "ru")).toBe("До окончания игровой сессии осталось 11 минут.");
    expect(toastText(15, "en")).toBe("Your gaming session ends in 15 minutes.");
    expect(toastText(1, "en")).toBe("Your gaming session ends in 1 minute.");
    expect(toastText(15, "am")).toBe("Մինչև խաղային սեսիայի ավարտը մնացել է 15 րոպե։");
  });

  it("builds the branded card: logo, Cyber Place, the message; no script", () => {
    const html = toastHtml(15, "en", TOAST_LOGO_DATA_URI);
    expect(html).toContain("Your gaming session ends in 15\u00a0minutes.");
    expect(html).toContain(">Cyber Place<");
    expect(html).toContain(`src="${TOAST_LOGO_DATA_URI}"`);
    expect(html.indexOf(TOAST_LOGO_DATA_URI)).toBeLessThan(html.indexOf("Cyber Place<"));
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("—");
  });

  it("never puts anything but an inlined PNG in the image", () => {
    expect(toastHtml(15, "ru", "https://evil.test/x.png")).not.toContain("<img");
    expect(toastHtml(15, "ru", "data:text/html;base64,PHNjcmlwdD4=")).not.toContain("<img");
  });

  it("the logo is the inlined PNG", () => {
    expect(TOAST_LOGO_DATA_URI.startsWith("data:image/png;base64,")).toBe(true);
    expect(TOAST_LOGO_DATA_URI.length).toBeGreaterThan(1000);
  });
});

describe("the sound (2026-10-18)", () => {
  it("is on: one OS beep as each message appears", async () => {
    const { TOAST_SOUND } = await import("./sessionToast");
    expect(TOAST_SOUND).toBe(true);
  });
});
