// Elementele de interfață: lista camerelor, punctele de vedere, mesajele de stare.
// Minimap-ul e în minimap.js, editorul (?edit=1) în editor.js.

function button(label, onClick, id) {
  const b = document.createElement("button");
  b.textContent = label;
  if (id) b.dataset.id = id;
  b.addEventListener("click", onClick);
  return b;
}

export function buildRoomBar(rooms, onSelect) {
  const nav = document.getElementById("rooms");
  nav.replaceChildren(...rooms.map((r) => button(r.name, () => onSelect(r), r.id)));
}

export function buildViewpointBar(viewpoints, onSelect) {
  const bar = document.getElementById("viewpoints");
  bar.replaceChildren(...viewpoints.map((vp) => button(vp.name, () => onSelect(vp))));
}

export function setStatus(text) {
  document.getElementById("status").textContent = text;
}

// Planul apartamentului (floorplan.svg) mare, peste scenă; se închide cu click sau Esc.
export function showFloorplan(url, title) {
  const close = () => { overlay.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const img = document.createElement("img");
  img.src = url;
  img.alt = `Planul: ${title}`;
  const open = document.createElement("a");
  open.href = url;
  open.target = "_blank";
  open.textContent = "Deschide separat (pentru print)";
  open.addEventListener("click", (e) => e.stopPropagation());
  const overlay = document.createElement("div");
  overlay.id = "floorplan";
  overlay.append(img, open);
  overlay.addEventListener("click", close);
  addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}
