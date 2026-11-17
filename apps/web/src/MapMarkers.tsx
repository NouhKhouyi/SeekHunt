import type { LatLng, MapMark } from "@seekhunt/shared";
import { Eye, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmt } from "./ui";

export interface MapMarkView extends MapMark {
  label: string;
  own: boolean;
  editable: boolean;
}

export interface MapMarkPopup {
  key: string;
  pos: LatLng;
  content: ReactNode;
}

interface Props {
  map: maplibregl.Map | null;
  marks: MapMarkView[];
  now: number;
  popup?: MapMarkPopup;
  onTap?: (id: string) => void;
  onMove?: (id: string, pos: LatLng) => void;
}

const HOLD_MS = 450;
const MOVE_TOLERANCE = 8;

/** Pointer events cover mouse, touch and pen without two competing drag implementations. */
function holdToMove(
  map: maplibregl.Map,
  marker: maplibregl.Marker,
  button: HTMLButtonElement,
  editable: () => boolean,
  onMove: (pos: LatLng) => void,
  onTap: () => void,
) {
  let gesture: {
    pointer: number;
    x: number;
    y: number;
    original: maplibregl.LngLat;
    held: boolean;
    moved: boolean;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressClick = false;
  const stop = (e: Event) => e.stopPropagation();
  const cancel = () => {
    clearTimeout(timer);
    const previous = gesture;
    gesture = null;
    button.classList.remove("holding", "moving");
    if (previous) {
      if (previous.held) marker.setLngLat(previous.original);
      if (button.hasPointerCapture(previous.pointer)) button.releasePointerCapture(previous.pointer);
    }
  };
  const down = (e: PointerEvent) => {
    if (!e.isPrimary) {
      suppressClick = true;
      cancel();
      return;
    }
    if (e.button !== 0) return;
    suppressClick = false;
    if (!editable()) return;
    cancel();
    gesture = { pointer: e.pointerId, x: e.clientX, y: e.clientY, original: marker.getLngLat(), held: false, moved: false };
    button.setPointerCapture(e.pointerId);
    button.classList.add("holding");
    timer = setTimeout(() => {
      if (!gesture || !editable()) return cancel();
      gesture.held = true;
      suppressClick = true;
      button.classList.remove("holding");
      button.classList.add("moving");
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    if (!editable()) return cancel();
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.held) {
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
        suppressClick = true;
        cancel();
      }
      return;
    }
    e.preventDefault();
    gesture.moved ||= Math.hypot(dx, dy) > 1;
    // Preserve the grab offset, so the flag never jumps to the finger's centre.
    const start = map.project(gesture.original);
    const pos = map.unproject([start.x + dx, start.y + dy]);
    marker.setLngLat([pos.lng, Math.max(-85, Math.min(85, pos.lat))]);
  };
  const up = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const moved = gesture.held && gesture.moved && editable();
    const pos = marker.getLngLat().wrap();
    cancel();
    if (moved) onMove({ lat: pos.lat, lng: pos.lng });
    // cancel() restores the authoritative position until the server accepts the move.
  };
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    // Keyboard-generated clicks still work after a pointer drag.
    if (!suppressClick || e.detail === 0) onTap();
    suppressClick = false;
  };
  const context = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", cancel);
  button.addEventListener("mousedown", stop);
  button.addEventListener("touchstart", stop);
  button.addEventListener("dblclick", stop);
  button.addEventListener("contextmenu", context);
  button.addEventListener("click", click);
  window.addEventListener("blur", cancel);
  return {
    active: () => gesture !== null,
    cancel,
    dispose: () => {
      cancel();
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointermove", move);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", cancel);
      button.removeEventListener("lostpointercapture", cancel);
      button.removeEventListener("mousedown", stop);
      button.removeEventListener("touchstart", stop);
      button.removeEventListener("dblclick", stop);
      button.removeEventListener("contextmenu", context);
      button.removeEventListener("click", click);
      window.removeEventListener("blur", cancel);
    },
  };
}

type Entry = { marker: maplibregl.Marker; button: HTMLButtonElement; drag: ReturnType<typeof holdToMove> };

/** Like player avatars, notes are DOM markers diffed by id; React supplies their icons and clocks. */
export function MapMarkers({ map, marks, now, popup, onTap, onMove }: Props) {
  const entries = useRef(new Map<string, Entry>());
  const [hosts, setHosts] = useState<{ id: string; button: HTMLButtonElement }[]>([]);
  const latest = useRef({ marks, onTap, onMove });
  latest.current = { marks, onTap, onMove };
  const [popupHost] = useState(() => document.createElement("div"));
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!map) return;
    const seen = new Set<string>();
    let changed = false;
    for (const mark of marks) {
      seen.add(mark.id);
      let entry = entries.current.get(mark.id);
      if (!entry) {
        const button = document.createElement("button");
        button.type = "button";
        const marker = new maplibregl.Marker({ element: button, anchor: "bottom-left" })
          .setLngLat([mark.pos.lng, mark.pos.lat])
          .addTo(map);
        const drag = holdToMove(
          map,
          marker,
          button,
          () => !!latest.current.marks.find((m) => m.id === mark.id)?.editable,
          (pos) => latest.current.onMove?.(mark.id, pos),
          () => latest.current.onTap?.(mark.id),
        );
        entry = { marker, button, drag };
        entries.current.set(mark.id, entry);
        changed = true;
      }
      if (!mark.editable) entry.drag.cancel();
      if (!entry.drag.active()) entry.marker.setLngLat([mark.pos.lng, mark.pos.lat]);
      entry.button.classList.add("map-mark");
      entry.button.classList.toggle("suspect", mark.kind === "suspect");
      entry.button.classList.toggle("clear", mark.kind === "clear");
      entry.button.classList.toggle("own", mark.own);
      entry.button.setAttribute("aria-label", mark.label);
      entry.button.title = mark.label;
    }
    for (const [id, entry] of entries.current) {
      if (seen.has(id)) continue;
      entry.drag.dispose();
      entry.marker.remove();
      entries.current.delete(id);
      changed = true;
    }
    if (changed) setHosts([...entries.current].map(([id, entry]) => ({ id, button: entry.button })));
  }, [map, marks]);

  useEffect(() => () => {
    for (const entry of entries.current.values()) {
      entry.drag.dispose();
      entry.marker.remove();
    }
    entries.current.clear();
  }, [map]);

  useEffect(() => {
    if (!map || !popup) return;
    const previousFocus = document.activeElement;
    const instance = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "280px",
      offset: 28,
      className: "map-mark-popup",
    })
      .setLngLat([popup.pos.lng, popup.pos.lat])
      .setDOMContent(popupHost)
      .addTo(map);
    popupRef.current = instance;
    popupHost.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      instance.remove();
      popupRef.current = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
    // Content and coordinates update independently, without recreating the popup on each countdown tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, popup?.key, popupHost]);

  useEffect(() => {
    if (popup) popupRef.current?.setLngLat([popup.pos.lng, popup.pos.lat]);
  }, [popup?.pos.lat, popup?.pos.lng]);

  return <>
    {hosts.map(({ id, button }) => {
      const mark = marks.find((m) => m.id === id);
      return mark && createPortal(<>
        {mark.kind === "suspect" ? <Eye size={22} aria-hidden /> : <X size={22} aria-hidden />}
        <span className="num" aria-hidden>{fmt(mark.expiresAt - now)}</span>
      </>, button, id);
    })}
    {popup && createPortal(popup.content, popupHost)}
  </>;
}
