/**
 * "Your gaming session ends in N minutes" on the player's screen (2026-10-12):
 * the pure part, with no Electron in it so it is tested on its own
 * (`sessionToast.test.ts`). The window lives in `sessionToastWindow.ts`.
 *
 * Nothing here takes text from the server or the renderer: the only input is
 * a number of minutes, validated, and the OS language. The page is built from
 * fixed strings, so no markup can ever be injected into a window that sits on
 * top of everything.
 */

export type ToastLang = "ru" | "en" | "am";

/** How long the message stays on screen. */
export const TOAST_MS = 10_000;

/** A whole number of minutes 1..60, or null: anything else is refused. */
export const validMinutes = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 60 ? value : null;

/**
 * The player's language, from the OS locale (`app.getLocale()`): Armenian,
 * English, otherwise Russian, the language the kiosk already speaks to players.
 */
export const toastLangOf = (locale: string | null | undefined): ToastLang => {
  const l = (locale ?? "").toLowerCase();
  if (l.startsWith("hy")) return "am";
  if (l.startsWith("en")) return "en";
  return "ru";
};

const ruMinutes = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "минута";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "минуты";
  return "минут";
};

/** The sentence, in the player's language. */
export const toastText = (minutes: number, lang: ToastLang): string => {
  switch (lang) {
    case "en":
      return `Your gaming session ends in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    case "am":
      return `Մինչև խաղային սեսիայի ավարտը մնացել է ${minutes} րոպե։`;
    default:
      return `До окончания игровой сессии осталось ${minutes} ${ruMinutes(minutes)}.`;
  }
};

/**
 * The whole page, in the desktop's own look (2026-10-12): the Cyber Place logo
 * on top, "Cyber Place", then the message; the desktop's navy surface and its
 * cyan accent border. Fixed markup, no script, a CSP that allows only its own
 * inline style and `data:` images (the inlined logo). The only variable part
 * is the sentence, built from a validated integer.
 */
export const toastHtml = (minutes: number, lang: ToastLang, logoDataUri: string): string => {
  // The number never parts from its unit at a line break ("15 / минут").
  const text = toastText(minutes, lang).replace(`${minutes} `, `${minutes}\u00a0`);
  const htmlLang = lang === "am" ? "hy" : lang;
  const logo = logoDataUri.startsWith("data:image/png;base64,") ? logoDataUri : "";
  return `<!doctype html><html lang="${htmlLang}"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    + `<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none;cursor:default}`
    + `.t{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px 22px;border-radius:16px;text-align:center;`
    + `background:linear-gradient(180deg,#0b1327 0%,#020514 100%);border:1px solid rgba(7,221,241,.6);box-shadow:0 0 0 1px rgba(7,221,241,.12),0 0 24px rgba(7,221,241,.25),0 10px 30px rgba(0,0,0,.55);color:#fff}`
    + `.l{height:56px;width:auto;display:block}`
    + `.n{font-size:18px;font-weight:700;letter-spacing:.06em;color:#fff}`
    + `.m{font-size:15px;line-height:1.4;color:#cbd5e1;max-width:340px}</style></head>`
    + `<body><div class="t" role="status">`
    + (logo ? `<img class="l" src="${logo}" alt="">` : "")
    + `<div class="n">Cyber Place</div><div class="m">${text}</div></div></body></html>`;
};
