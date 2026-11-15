// Webview client for the Veriscode simulator panel: the editable timing
// diagram and the read-only Logical Schematic tab. Plain DOM/JS by design
// - no bundler, no framework - since it only ever runs inside one webview
// and the surface area is small. The extension-host side is
// src/webview/panel.ts, which documents the messages exchanged.
(function () {
  const vscode = acquireVsCodeApi();
  const { attach, netOf, makeBadge, makeRemoveButton } = window.VeriscodeSchematic;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const CELL_W = 56;
  const ROW_H = 30;
  /** Where each 1-bit level sits within a row. */
  const WAVE_Y = { 1: 6, 0: ROW_H - 6, z: ROW_H / 2 };

  /** @type {{module: {name: string, ports: any[]}, steps: Record<string,string>[], clockPeriodNs: number, hasClock: boolean, instances: any[]}} */
  let state = { module: { name: "", ports: [] }, steps: [], clockPeriodNs: 10, hasClock: false, instances: [] };
  /** Signal name -> one value per step, from the latest successful run. Empty until one arrives. */
  let results = new Map();

  const el = Object.fromEntries(
    [
      "title", "subtitle", "status", "errorLog", "diagram", "addCycle", "rerun",
      "tabTiming", "tabSchematic", "timingView", "schematicView", "schematicLegend", "schematicCanvas",
    ].map((id) => [id, document.getElementById(id)])
  );
  const schematic = attach(el.schematicCanvas);

  el.addCycle.addEventListener("click", () => vscode.postMessage({ type: "addCycle" }));
  el.rerun.addEventListener("click", () => vscode.postMessage({ type: "rerun" }));
  el.tabTiming.addEventListener("click", () => selectTab(el.tabTiming));
  el.tabSchematic.addEventListener("click", () => selectTab(el.tabSchematic));

  function selectTab(selectedTab) {
    for (const [tab, view] of [[el.tabTiming, el.timingView], [el.tabSchematic, el.schematicView]]) {
      tab.setAttribute("aria-selected", String(tab === selectedTab));
      view.hidden = tab !== selectedTab;
    }
    if (!el.schematicView.hidden) renderSchematic();
  }

  window.addEventListener("message", ({ data: msg }) => {
    switch (msg.type) {
      case "init":
        state = msg.state;
        results = new Map();
        render();
        break;
      case "steps":
        state.steps = msg.steps;
        render();
        break;
      case "status":
        setStatus(msg.message, msg.kind);
        break;
      case "result":
        showResult(msg.result);
        break;
    }
  });

  function showResult(result) {
    // After a failed run the outputs are left blank rather than showing
    // values from an earlier, different run.
    results = new Map(result.ok ? result.signals.map((signal) => [signal.name, signal.values]) : []);
    if (result.ok) {
      const count = state.steps.length;
      const unit = state.hasClock ? "cycle" : "step";
      setStatus(`Simulated ${count} ${unit}${count === 1 ? "" : "s"}`, "ok");
    } else {
      setStatus("Simulation failed - see the log below", "error");
      el.errorLog.textContent = result.log;
    }
    el.errorLog.hidden = result.ok;
    renderValues();
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = kind;
  }

  /**
   * The value to show for a signal at a step: the simulated one if there
   * is a result, else what's staged for an input, else undefined (an
   * output with nothing to show yet).
   */
  function valueAt(signalName, stepIndex) {
    return results.get(signalName)?.[stepIndex] ?? state.steps[stepIndex]?.[signalName];
  }

  const isEditable = (port) => port.direction === "input" && !port.isClockLike;

  // --- Timing diagram ------------------------------------------------------

  function render() {
    el.title.textContent = `module ${state.module.name}`;
    el.subtitle.textContent = state.hasClock
      ? `Clocked design - one column per clock cycle (${state.clockPeriodNs}ns period)`
      : "Combinational design - one column per time step";
    el.addCycle.textContent = state.hasClock ? "+ Cycle" : "+ Step";

    const stepCount = state.steps.length;
    el.diagram.replaceChildren();
    el.diagram.style.gridTemplateColumns = `max-content repeat(${stepCount}, ${CELL_W}px)`;

    el.diagram.appendChild(makeDiv("row-label header-cell"));
    for (let i = 0; i < stepCount; i++) {
      const header = makeDiv("header-cell", state.hasClock ? `cycle ${i}` : `t${i}`);
      if (stepCount > 1) {
        header.appendChild(
          makeRemoveButton("Remove this column", () => vscode.postMessage({ type: "removeStep", step: i }))
        );
      }
      el.diagram.appendChild(header);
    }

    // Inputs first, then outputs. The clock gets no row: it isn't editable
    // and, sampled once per cycle, would just be a flat line.
    const ports = state.module.ports;
    for (const port of ports.filter(isEditable)) renderRow(port);
    for (const port of ports.filter((p) => p.direction !== "input")) renderRow(port);
    renderValues();

    if (!el.schematicView.hidden) renderSchematic();
  }

  function renderRow(port) {
    const label = makeDiv("row-label");
    label.appendChild(makeSpan("signal-name", port.name));
    label.appendChild(makeBadge(port.direction, port.direction + rangeOf(port)));
    if (port.resetPolarity) {
      const activeLow = port.resetPolarity === "active-low";
      const badge = makeBadge("reset", activeLow ? "reset (low)" : "reset (high)");
      badge.title = activeLow
        ? "Looks like an active-low reset: 0 = held in reset, 1 = running normally."
        : "Looks like an active-high reset: 1 = held in reset, 0 = running normally.";
      label.appendChild(badge);
    }
    el.diagram.appendChild(label);

    if (port.width === 1) {
      el.diagram.appendChild(makeWaveCell(port));
    } else {
      state.steps.forEach((_, i) => el.diagram.appendChild(makeBusCell(port, i)));
    }
  }

  /** " [7:0]" for a bus, "" for a single bit. */
  function rangeOf(port) {
    return port.width > 1 ? ` [${port.width - 1}:0]` : "";
  }

  function makeDiv(className, text = "") {
    const div = document.createElement("div");
    div.className = className;
    div.textContent = text;
    return div;
  }

  function makeSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  /** One cell of a multi-bit row; its text is filled in by renderValues. */
  function makeBusCell(port, stepIndex) {
    const cell = makeDiv(`cell bus-cell ${port.direction}`);
    cell.dataset.signal = port.name;
    cell.dataset.step = String(stepIndex);
    if (isEditable(port)) {
      cell.classList.add("editable");
      cell.addEventListener("click", () => {
        if (cell.querySelector("input")) return; // Already editing.
        cell.textContent = "";
        openEditor(cell, port.name, stepIndex);
      });
    }
    return cell;
  }

  /** A 1-bit row: one SVG spanning every step; the trace is drawn by renderValues. */
  function makeWaveCell(port) {
    const width = state.steps.length * CELL_W;
    const cell = makeDiv("cell wave-row");
    cell.style.gridColumn = `span ${state.steps.length}`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", `wave ${port.direction}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(ROW_H));
    svg.dataset.signal = port.name;
    cell.appendChild(svg);
    return cell;
  }

  /**
   * Puts a text field into `host` for editing one input value. Enter or
   * clicking away commits (blank means 0); Escape puts the old value back.
   */
  function openEditor(host, signalName, stepIndex) {
    const current = state.steps[stepIndex]?.[signalName] ?? "0";
    const input = document.createElement("input");
    input.className = "cell-edit-input";
    input.spellcheck = false;
    input.value = current;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") input.value = current;
      if (e.key === "Enter" || e.key === "Escape") input.blur();
    });
    input.addEventListener(
      "blur",
      () => {
        const value = input.value.trim() || "0";
        state.steps[stepIndex][signalName] = value;
        input.remove();
        renderValues();
        if (value !== current) {
          vscode.postMessage({ type: "setValue", step: stepIndex, signal: signalName, value });
        }
      },
      { once: true }
    );
    host.appendChild(input);
    input.focus();
    input.select();
  }

  /** Fills every cell and trace from the latest values. Runs after each simulation result. */
  function renderValues() {
    for (const cell of el.diagram.querySelectorAll(".bus-cell")) {
      if (cell.querySelector("input")) continue; // Mid-edit: don't clobber it.
      const step = Number(cell.dataset.step);
      const value = valueAt(cell.dataset.signal, step) ?? "";
      cell.textContent = value;
      cell.title = describeValue(value);
      cell.classList.toggle("unknown", /^[xz]$/i.test(value));
      cell.classList.toggle("changed", step > 0 && value !== (valueAt(cell.dataset.signal, step - 1) ?? ""));
    }
    for (const svg of el.diagram.querySelectorAll("svg.wave")) {
      if (svg.querySelector("input")) continue;
      const port = state.module.ports.find((p) => p.name === svg.dataset.signal);
      drawWave(svg, port);
    }
  }

  /** A tooltip giving a simulated bus value in decimal, hex and binary. */
  function describeValue(value) {
    if (!/^\d+$/.test(value)) return "";
    const n = BigInt(value);
    return `${n} = 0x${n.toString(16).toUpperCase()} = 0b${n.toString(2)}`;
  }

  /**
   * Classifies a 1-bit value: "0", "1", "z" (high impedance), "x"
   * (unknown), or undefined when there is nothing to draw yet. Besides
   * simulated values this sees staged input text, so `1'b1` and `'1` count as 1.
   */
  function levelOf(value) {
    if (value === undefined) return undefined;
    const bit = /^(?:1?'[bdh]?)?([01xz])$/i.exec(value.trim());
    return bit ? bit[1].toLowerCase() : "x";
  }

  function svgElement(tag, className, attrs) {
    const element = document.createElementNS(SVG_NS, tag);
    element.setAttribute("class", className);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
    return element;
  }

  function drawWave(svg, port) {
    const stepCount = state.steps.length;
    const shapes = [];
    const add = (tag, className, attrs, tooltip) => {
      const shape = svgElement(tag, className, attrs);
      if (tooltip) shape.appendChild(document.createElementNS(SVG_NS, "title")).textContent = tooltip;
      shapes.push(shape);
      return shape;
    };

    for (let i = 1; i < stepCount; i++) {
      add("line", "grid", { x1: i * CELL_W, x2: i * CELL_W, y1: 0, y2: ROW_H });
    }

    // One continuous trace through runs of 0/1 (with a vertical edge
    // wherever the level changes); x and z steps interrupt it and are
    // drawn as their own shapes.
    let trace = "";
    let penDown = false;
    for (let i = 0; i < stepCount; i++) {
      const level = levelOf(valueAt(port.name, i));
      const x = i * CELL_W;
      if (level === "0" || level === "1") {
        trace += `${penDown ? "L" : "M"} ${x} ${WAVE_Y[level]} L ${x + CELL_W} ${WAVE_Y[level]} `;
        penDown = true;
        continue;
      }
      penDown = false;
      if (level === "x") {
        const band = { x, y: WAVE_Y[1], width: CELL_W, height: WAVE_Y[0] - WAVE_Y[1] };
        add("rect", "unknown", band, "x - unknown value");
      } else if (level === "z") {
        add("line", "high-z", { x1: x, x2: x + CELL_W, y1: WAVE_Y.z, y2: WAVE_Y.z }, "z - not driven (high impedance)");
      }
    }
    add("path", "trace", { d: trace.trim() });

    if (isEditable(port)) {
      for (let i = 0; i < stepCount; i++) {
        const hit = add("rect", "hit", { x: i * CELL_W, y: 0, width: CELL_W, height: ROW_H });
        hit.addEventListener("click", () => {
          const frame = { x: i * CELL_W + 2, y: 2, width: CELL_W - 4, height: ROW_H - 4 };
          openEditor(svg.appendChild(svgElement("foreignObject", "editor", frame)), port.name, i);
        });
      }
    }
    svg.replaceChildren(...shapes);
  }

  // --- Logical Schematic ---------------------------------------------------
  // A structural picture of the module and the submodules it instantiates,
  // built from the source text. It shows wiring only, not live values.

  function renderSchematic() {
    schematic.render([
      { id: "top", el: makeTopBox() },
      ...state.instances.map((inst) => ({ id: `inst:${inst.instanceName}`, el: makeInstanceBox(inst) })),
    ]);
    el.schematicLegend.textContent =
      state.instances.length === 0
        ? "This module doesn't instantiate any submodules - it's a single block."
        : "Drag a box by its title bar to rearrange. Hover a port to highlight everything on the same net.";
  }

  function makeBox(title, subtitle, isTop) {
    const box = makeDiv(`schematic-box${isTop ? " top" : ""}`);
    const titleBar = makeDiv("box-title", title);
    titleBar.appendChild(makeSpan("box-subtitle", subtitle));
    box.appendChild(titleBar);
    return box;
  }

  /** The module itself: each port is its own net, driven from outside if it's an input. */
  function makeTopBox() {
    const box = makeBox(state.module.name, "top-level module", true);
    for (const port of state.module.ports) {
      const row = makeDiv("schematic-port-row");
      row.dataset.net = port.name;
      if (port.direction === "input") row.dataset.driver = "";
      const left = makeSpan("port", "");
      left.append(makeBadge(port.direction), makeSpan("port-name", port.name));
      row.append(left, makeSpan("port-detail", rangeOf(port).trim()));
      box.appendChild(row);
    }
    return box;
  }

  /** A submodule instance: each port shows what it is wired to. */
  function makeInstanceBox(inst) {
    const box = makeBox(inst.instanceName, inst.moduleType, false);
    for (const port of inst.ports) {
      const row = makeDiv("schematic-port-row");
      row.dataset.net = netOf(port.net);
      if (port.direction === "output") row.dataset.driver = "";
      const left = makeSpan("port", "");
      if (port.direction) left.appendChild(makeBadge(port.direction));
      left.appendChild(makeSpan("port-name", port.name));
      row.append(left, makeSpan(port.net ? "net-name" : "port-detail", port.net || "unconnected"));
      box.appendChild(row);
    }
    return box;
  }

  vscode.postMessage({ type: "ready" });
})();
