import { useAppVersion } from "./appVersion";

/**
 * Wordmark + Cyber Place logo, used on every fullscreen agent
 * surface (Active / Lock / Offline / Setup). Centralising it
 * here means a future logo / colour change touches exactly one
 * file — and the four screens can't drift visually because they
 * all render the same component.
 *
 * Under the logo and the name: a small, quiet "Версия X" line with
 * the installed agent version (see `appVersion.ts`). It is laid out
 * absolutely inside the gap below the mark, so it never moves the
 * PIN pad or anything else on the screen, including when it appears
 * a moment after the first paint. No version known ⇒ no line.
 *
 * `logo.png` lives in `public/` so Vite ships it as a static
 * asset and the relative `./logo.png` reference works under both
 * the dev server and the packaged `file://` load.
 */
interface Props {
  /**
   * Override the wordmark text. Defaults to 'CYBER PLACE' on every
   * surface (Active / Lock / Offline / Setup).
   */
  text?: string;
}

const BrandMark = ({ text = "CYBER PLACE" }: Props) => {
  const version = useAppVersion();
  return (
    <div className="brand">
      <div className="brand-row">
        <img src="./logo.png" alt="" aria-hidden className="brand-logo" />
        <span className="brand-text">{text}</span>
      </div>
      {version && <div className="brand-version">Версия {version}</div>}
    </div>
  );
};

export default BrandMark;
