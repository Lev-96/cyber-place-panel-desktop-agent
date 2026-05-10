/**
 * Wordmark + Cyber Place logo, used on every fullscreen agent
 * surface (Active / Lock / Offline / Setup). Centralising it
 * here means a future logo / colour change touches exactly one
 * file — and the four screens can't drift visually because they
 * all render the same component.
 *
 * `logo.png` lives in `public/` so Vite ships it as a static
 * asset and the relative `./logo.png` reference works under both
 * the dev server and the packaged `app://` Electron protocol
 * (same path resolution rule the desktop panel uses).
 */
interface Props {
  /**
   * Override the wordmark text. Default 'CYBER PLACE' covers the
   * three runtime screens; SetupScreen passes 'CYBER PLACE · CLIENT'
   * to distinguish the first-time pairing surface from the
   * normal kiosk fullscreen.
   */
  text?: string;
}

const BrandMark = ({ text = "CYBER PLACE" }: Props) => (
  <div className="brand">
    <img src="./logo.png" alt="" aria-hidden className="brand-logo" />
    <span className="brand-text">{text}</span>
  </div>
);

export default BrandMark;
