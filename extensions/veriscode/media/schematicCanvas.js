// The box-and-wire canvas shared by the simulator's read-only Logical
// Schematic tab (main.js) and the top-module composer (composer.js).
//
// Callers build the boxes; this lays them out, makes them draggable by
// their title bar, and draws a wire between port rows on the same net.
// The markup contract:
//
//   .schematic-box                      one module (top-level or instance)
//     .box-title                        the drag handle
//     .schematic-port-row[data-net]     a port wired to net `data-net`
//                        [data-driver]  present if the port drives its net
//
// A row with no (or an empty) data-net is unconnected and gets no wire.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MARGIN = 24; // Canvas edge to the first box, and around the content.
  const COLUMN_GAP = 96; // Top-level box to the column of instances.
  const ROW_GAP = 24; // Between stacked instance boxes.
  const MIN_HEIGHT = 320;

  /**
   * A port connection expression as a net name: `sum0` and `data[3:0]`
   * give "sum0" and "data"; anything else (a literal, a concatenation,
   * blank) gives "" because it doesn't name a single wire to draw.
   */
  function netOf(expression) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_$]*)\s*(\[[^\]]*\])?\s*$/.exec(expression ?? "");
    return match ? match[1] : "";
  }

  /** Takes over `canvasEl`. Call once; then render() as often as the boxes change. */
  function attach(canvasEl) {
    /** @type {Record<string, {x: number, y: number}>} Survives re-renders, keyed by box id. */
    const positions = {};
    const wireLayer = document.createElementNS(SVG_NS, "svg");
    wireLayer.setAttribute("class", "wires");
    wireLayer.setAttribute("aria-hidden", "true");

    function place(box) {
      const pos = positions[box.dataset.boxId];
      box.style.left = `${pos.x}px`;
      box.style.top = `${pos.y}px`;
    }

    /**
     * Replaces the canvas content with `boxes` ({id, el} each, the
     * top-level box first). A box seen before keeps its position; a new
     * one is stacked in a column to the right of the top-level box, below
     * whatever is already there.
     */
    function render(boxes) {
      canvasEl.replaceChildren(wireLayer, ...boxes.map((box) => box.el));
      let columnX = MARGIN;
      let nextY = MARGIN;
      boxes.forEach(({ id, el }, index) => {
        el.dataset.boxId = id;
        positions[id] ??= index === 0 ? { x: MARGIN, y: MARGIN } : { x: columnX, y: nextY };
        place(el);
        if (index === 0) {
          columnX = MARGIN + el.offsetWidth + COLUMN_GAP;
        } else {
          nextY = Math.max(nextY, positions[id].y + el.offsetHeight + ROW_GAP);
        }
      });
      refresh();
    }

    // Dragging and window resizing fire far more often than the screen
    // repaints; re-measuring every box and rebuilding every wire each time
    // would be wasted, so those are coalesced to one refresh per frame.
    let refreshQueued = false;
    function refreshNextFrame() {
      if (refreshQueued) return;
      refreshQueued = true;
      requestAnimationFrame(() => {
        refreshQueued = false;
        refresh();
      });
    }

    /** Re-fits the canvas to its boxes and redraws every wire. Call after a net name changes. */
    function refresh() {
      const boxes = [...canvasEl.querySelectorAll(".schematic-box")];
      const right = Math.max(0, ...boxes.map((box) => box.offsetLeft + box.offsetWidth));
      const bottom = Math.max(0, ...boxes.map((box) => box.offsetTop + box.offsetHeight));
      canvasEl.style.minHeight = `${Math.max(MIN_HEIGHT, bottom + MARGIN)}px`;
      wireLayer.setAttribute("width", String(Math.max(canvasEl.clientWidth, right + MARGIN)));
      wireLayer.setAttribute("height", String(Math.max(canvasEl.clientHeight, bottom + MARGIN)));
      drawWires();
    }

    function drawWires() {
      /** @type {Map<string, HTMLElement[]>} */
      const rowsByNet = new Map();
      for (const row of canvasEl.querySelectorAll(".schematic-port-row[data-net]")) {
        const net = row.dataset.net;
        if (!net) continue;
        if (!rowsByNet.has(net)) rowsByNet.set(net, []);
        rowsByNet.get(net).push(row);
      }

      const paths = [];
      for (const [net, rows] of rowsByNet) {
        // Fan out from the port that drives the net (or, if unknown, the first one on it).
        const hub = rows.find((row) => "driver" in row.dataset) ?? rows[0];
        for (const row of rows) {
          if (row === hub || row.closest(".schematic-box") === hub.closest(".schematic-box")) continue;
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("class", "wire");
          path.setAttribute("d", wirePath(hub, row));
          path.dataset.net = net;
          paths.push(path);
        }
      }
      wireLayer.replaceChildren(...paths);
    }

    /** An S-curve from one port row to another, leaving each box by the side that faces the other. */
    function wirePath(fromRow, toRow) {
      const from = rowGeometry(fromRow);
      const to = rowGeometry(toRow);
      const CLEARANCE = 24;
      let x1, x2, control1, control2;
      if (to.left - from.right >= CLEARANCE) {
        [x1, x2] = [from.right, to.left];
        const bend = Math.max(CLEARANCE, (x2 - x1) / 2);
        [control1, control2] = [x1 + bend, x2 - bend];
      } else if (from.left - to.right >= CLEARANCE) {
        [x1, x2] = [from.left, to.right];
        const bend = Math.max(CLEARANCE, (x1 - x2) / 2);
        [control1, control2] = [x1 - bend, x2 + bend];
      } else {
        // The boxes overlap horizontally (e.g. stacked in a column): loop around the right-hand side.
        [x1, x2] = [from.right, to.right];
        const bend = 40 + Math.abs(to.y - from.y) / 6;
        [control1, control2] = [x1 + bend, x2 + bend];
      }
      return `M ${x1} ${from.y} C ${control1} ${from.y}, ${control2} ${to.y}, ${x2} ${to.y}`;
    }

    /** A row's vertical centre and its box's left/right edges, in canvas coordinates. */
    function rowGeometry(row) {
      const box = row.closest(".schematic-box");
      return {
        left: box.offsetLeft,
        right: box.offsetLeft + box.offsetWidth,
        y: box.offsetTop + row.offsetTop + row.offsetHeight / 2,
      };
    }

    // Dragging: one set of listeners for the whole canvas, however many
    // boxes come and go. Grabbing a control inside a title bar (the
    // instance name field, a remove button) doesn't start a drag.
    let drag = null;
    canvasEl.addEventListener("mousedown", (e) => {
      const title = e.target.closest(".box-title");
      if (!title || e.button !== 0 || e.target.closest("input, select, button")) return;
      const box = title.closest(".schematic-box");
      const pos = positions[box.dataset.boxId];
      drag = { box, pos, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y };
      box.classList.add("dragging");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      drag.pos.x = Math.max(0, e.clientX - drag.offsetX);
      drag.pos.y = Math.max(0, e.clientY - drag.offsetY);
      place(drag.box);
      refreshNextFrame();
    });
    window.addEventListener("mouseup", () => {
      drag?.box.classList.remove("dragging");
      drag = null;
    });
    window.addEventListener("resize", refreshNextFrame);

    // Hovering a port highlights its whole net: every port on it, and the wires between them.
    function highlightNet(net, on) {
      if (!net) return;
      for (const el of canvasEl.querySelectorAll("[data-net]")) {
        if (el.dataset.net === net) el.classList.toggle("highlight", on);
      }
    }
    canvasEl.addEventListener("mouseover", (e) => highlightNet(e.target.closest?.(".schematic-port-row")?.dataset.net, true));
    canvasEl.addEventListener("mouseout", (e) => highlightNet(e.target.closest?.(".schematic-port-row")?.dataset.net, false));

    return {
      render,
      refresh,
      /** Drops a removed box's saved position. */
      forget: (id) => delete positions[id],
    };
  }

  /** A port-direction badge ("input" / "output" / "inout"), or a custom-labelled one of the same style. */
  function makeBadge(kind, text = kind) {
    const badge = document.createElement("span");
    badge.className = `dir ${kind}`;
    badge.textContent = text;
    return badge;
  }

  /** A small "✕" button. */
  function makeRemoveButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.textContent = "✕";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  window.VeriscodeSchematic = { attach, netOf, makeBadge, makeRemoveButton };
})();
