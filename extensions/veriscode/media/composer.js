// Webview client for the "Build Top Module" composer: a palette of the
// folder's modules, a canvas of instances whose ports are wired by typing
// net names, and the top module's own port list. Plain DOM/JS, like
// main.js. The extension-host side is src/webview/composerPanel.ts.
(function () {
  const vscode = acquireVsCodeApi();
  const { attach, netOf, makeBadge, makeRemoveButton } = window.VeriscodeSchematic;

  /** @type {{folderName: string, library: Array<{name: string, ports: Array<{name: string, direction: string, width: number}>}>}} */
  let folder = { folderName: "", library: [] };

  /** The ports of the module being built: {id, name, direction, width}. */
  let topPorts = [];
  /** The instances on the canvas: {id, instanceName, moduleType, ports: [{name, direction, width, netName}]}. */
  let instances = [];
  /** Source of unique ids for the two lists above. */
  let nextId = 0;

  const el = Object.fromEntries(
    ["subtitle", "paletteList", "topName", "addPort", "generate", "errorLog", "successLog", "canvas", "netNames"].map(
      (id) => [id, document.getElementById(id)]
    )
  );
  const canvas = attach(el.canvas);

  window.addEventListener("message", ({ data: msg }) => {
    if (msg.type === "init") {
      folder = msg.state;
      el.subtitle.textContent = `Wire up the modules found in "${folder.folderName}" without writing the instantiation code by hand.`;
      renderPalette();
      renderCanvas();
    } else if (msg.type === "generateResult") {
      showResult(msg);
    }
  });

  el.addPort.addEventListener("click", () => {
    topPorts.push({ id: `port${nextId++}`, name: `port${topPorts.length}`, direction: "input", width: 1 });
    renderCanvas();
  });

  el.generate.addEventListener("click", () => {
    vscode.postMessage({
      type: "generate",
      spec: {
        topName: el.topName.value.trim(),
        topPorts: topPorts.map((p) => ({ name: p.name.trim(), direction: p.direction, width: p.width })),
        instances: instances.map((inst) => ({
          instanceName: inst.instanceName.trim(),
          moduleType: inst.moduleType,
          connections: inst.ports.map((p) => ({
            portName: p.name,
            direction: p.direction,
            width: p.width,
            netName: p.netName.trim(),
          })),
        })),
      },
    });
  });

  function showResult(result) {
    el.errorLog.hidden = result.ok;
    el.successLog.hidden = !result.ok;
    if (result.ok) {
      el.successLog.textContent = `Created ${result.fileName} and opened it in the editor.`;
    } else {
      el.errorLog.textContent = result.errors.join("\n");
    }
  }

  function renderPalette() {
    el.paletteList.replaceChildren(
      ...folder.library.map((mod) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "palette-item";
        item.append(
          makeElement("span", "palette-item-name", mod.name),
          makeElement("span", "palette-item-detail", `${mod.ports.length} port${mod.ports.length === 1 ? "" : "s"}`)
        );
        item.addEventListener("click", () => addInstance(mod));
        return item;
      })
    );
  }

  function addInstance(mod) {
    const sameType = instances.filter((inst) => inst.moduleType === mod.name).length;
    instances.push({
      id: `inst${nextId++}`,
      instanceName: `${mod.name}_${sameType}`,
      moduleType: mod.name,
      ports: mod.ports.map((p) => ({ ...p, netName: "" })),
    });
    renderCanvas();
  }

  function renderCanvas() {
    canvas.render([
      { id: "top", el: makeTopBox() },
      ...instances.map((inst) => ({ id: inst.id, el: makeInstanceBox(inst) })),
    ]);
    refreshNetSuggestions();
  }

  /** Call after a net or port name is edited in place: redraws the wires to match. */
  function netsChanged() {
    canvas.refresh();
    refreshNetSuggestions();
  }

  /** Offers every top-level port and every net already in use as a completion for the net fields. */
  function refreshNetSuggestions() {
    const names = new Set(
      [...topPorts.map((p) => p.name.trim()), ...instances.flatMap((inst) => inst.ports.map((p) => p.netName.trim()))].filter(
        Boolean
      )
    );
    el.netNames.replaceChildren(...[...names].sort().map((name) => new Option(name)));
  }

  function makeElement(tag, className, text = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function makeTextInput(className, value, onInput) {
    const input = makeElement("input", `text-input ${className}`);
    input.type = "text";
    input.spellcheck = false;
    input.value = value;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  /** The module being built. Each of its ports is a net that instance ports can be wired to. */
  function makeTopBox() {
    const box = makeElement("div", "schematic-box top composer-top-box");
    const title = makeElement("div", "box-title", "Top-level ports");
    box.appendChild(title);

    if (topPorts.length === 0) {
      box.appendChild(makeElement("div", "schematic-port-row port-detail", 'Click "+ Top-Level Port" to add one.'));
    }

    for (const port of topPorts) {
      const row = makeElement("div", "schematic-port-row");
      const syncNet = () => {
        row.dataset.net = netOf(port.name);
        // An input is driven from outside the module, so on the canvas it's the source of its net.
        row.toggleAttribute("data-driver", port.direction === "input");
      };
      syncNet();

      const nameInput = makeTextInput("port-name-input", port.name, (value) => {
        port.name = value;
        syncNet();
        netsChanged();
      });
      nameInput.setAttribute("aria-label", "Port name");

      const directionSelect = makeElement("select", "text-input");
      directionSelect.setAttribute("aria-label", "Direction");
      for (const direction of ["input", "output", "inout"]) {
        directionSelect.appendChild(new Option(direction, direction, false, direction === port.direction));
      }
      directionSelect.addEventListener("change", () => {
        port.direction = directionSelect.value;
        syncNet();
        netsChanged();
      });

      const widthInput = makeElement("input", "text-input width-input");
      widthInput.type = "number";
      widthInput.min = "1";
      widthInput.value = String(port.width);
      widthInput.title = "Width in bits";
      widthInput.setAttribute("aria-label", "Width in bits");
      widthInput.addEventListener("input", () => {
        const width = parseInt(widthInput.value, 10);
        port.width = width >= 1 ? width : 1;
      });

      const remove = makeRemoveButton("Remove this port", () => {
        topPorts = topPorts.filter((p) => p !== port);
        renderCanvas();
      });
      row.append(nameInput, directionSelect, widthInput, remove);
      box.appendChild(row);
    }
    return box;
  }

  /** One placed instance: an editable name, and a net-name field per port. */
  function makeInstanceBox(inst) {
    const box = makeElement("div", "schematic-box");

    const title = makeElement("div", "box-title");
    const nameInput = makeTextInput("instance-name-input", inst.instanceName, (value) => (inst.instanceName = value));
    nameInput.setAttribute("aria-label", "Instance name");
    const remove = makeRemoveButton("Remove this instance", () => {
      instances = instances.filter((other) => other !== inst);
      canvas.forget(inst.id);
      renderCanvas();
    });
    title.append(nameInput, makeElement("span", "box-subtitle", inst.moduleType), remove);
    box.appendChild(title);

    for (const port of inst.ports) {
      const row = makeElement("div", "schematic-port-row");
      row.dataset.net = netOf(port.netName);
      row.toggleAttribute("data-driver", port.direction === "output");

      const label = makeElement("span", "port");
      label.append(makeBadge(port.direction), makeElement("span", "port-name", port.name));
      if (port.width > 1) label.appendChild(makeElement("span", "port-detail", `[${port.width - 1}:0]`));

      const netInput = makeTextInput("net-input", port.netName, (value) => {
        port.netName = value;
        row.dataset.net = netOf(value);
        netsChanged();
      });
      netInput.placeholder = "net name";
      netInput.setAttribute("list", "netNames");
      netInput.setAttribute("aria-label", `Net wired to ${port.name}`);

      row.append(label, netInput);
      box.appendChild(row);
    }
    return box;
  }

  vscode.postMessage({ type: "ready" });
})();
