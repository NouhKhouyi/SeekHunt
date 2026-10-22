import { Footprints, LifeBuoy, MapPinned, ShieldCheck, TrafficCone, UserCheck } from "lucide-react";

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

/**
 * Shown before location is ever requested: what is shared, with whom, for how long, and the
 * ground rules of playing in the street. Location sharing only starts after "Aceptar".
 */
export function Consent({ onAccept, onLeave }: { onAccept: () => void; onLeave: () => void }) {
  return (
    <div className="dialog-scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title" style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <span className="label">Antes de jugar</span>
        <h3 id="consent-title">Tu ubicación y las normas</h3>
        <ul className="rules">
          <li>
            <MapPinned size={18} />
            <span>
              <b>Compartes tu ubicación solo en esta sala</b> y solo mientras la tengas abierta. Los cazadores no te ven, salvo en el radar, si sales de la zona o si pides ayuda.
            </span>
          </li>
          <li>
            <ShieldCheck size={18} />
            <span>
              <b>No guardamos historial.</b> La sala y las posiciones se borran 12 h después de la última actividad. Puedes retirar el permiso en los ajustes del navegador.
            </span>
          </li>
          <li>
            <UserCheck size={18} />
            <span>
              <b>Tienes 14 años o más,</b> o juegas con permiso de tu madre, padre o tutor.
            </span>
          </li>
          <li>
            <Footprints size={18} />
            <span>
              <b>Se juega a pie.</b> Nada de bici, patinete ni coche. Por encima de 25 km/h no se puede pillar.
            </span>
          </li>
          <li>
            <TrafficCone size={18} />
            <span>
              <b>Respeta la calle.</b> No cruces carreteras corriendo ni entres en propiedades privadas, obras o vías de tren.
            </span>
          </li>
          <li>
            <LifeBuoy size={18} />
            <span>
              <b>Si algo va mal, pulsa SOS</b> y todos verán dónde estás. En una emergencia, llama al 112.
            </span>
          </li>
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
            Acepto, quiero jugar
          </button>
          <button className="btn btn-soft btn-block" onClick={onLeave}>
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
