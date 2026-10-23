import { Footprints, LifeBuoy, MapPinned, ShieldCheck, TrafficCone, UserCheck } from "lucide-react";
import { useT } from "./i18n";

const KEY = "seekhunt:consent:v1";

export function hasConsent(): boolean {
  try {
    return localStorage.getItem(KEY) === "yes";
  } catch {
    return false;
  }
}

function saveConsent() {
  try {
    localStorage.setItem(KEY, "yes");
  } catch {
    // Private mode: we'll ask again next time, which is fine.
  }
}

const RULES = [
  { icon: MapPinned, b: "consent.locB", text: "consent.loc" },
  { icon: ShieldCheck, b: "consent.histB", text: "consent.hist" },
  { icon: UserCheck, b: "consent.ageB", text: "consent.age" },
  { icon: Footprints, b: "consent.footB", text: "consent.foot" },
  { icon: TrafficCone, b: "consent.streetB", text: "consent.street" },
  { icon: LifeBuoy, b: "consent.sosB", text: "consent.sos" },
] as const;

/**
 * Shown before location is ever requested: what is shared, with whom, for how long, and the
 * ground rules of playing in the street. Location sharing only starts after "Aceptar".
 */
export function Consent({ onAccept, onLeave }: { onAccept: () => void; onLeave: () => void }) {
  const t = useT();
  return (
    <div className="dialog-scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title" style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <h3 id="consent-title">{t("consent.title")}</h3>
        <ul className="rules">
          {RULES.map(({ icon: Icon, b, text }) => (
            <li key={b}>
              <Icon size={18} />
              <span>
                <b>{t(b)}</b> {t(text)}
              </span>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button
            className="btn btn-block"
            autoFocus
            onClick={() => {
              saveConsent();
              onAccept();
            }}
          >
            {t("consent.accept")}
          </button>
          <button className="btn btn-soft btn-block" onClick={onLeave}>
            {t("consent.leave")}
          </button>
        </div>
      </div>
    </div>
  );
}
