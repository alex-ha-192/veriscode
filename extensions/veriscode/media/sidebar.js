// Webview client for the Activity Bar view: three launcher buttons and a
// summary of the module in the active editor. The extension-host side is
// src/webview/sidebarView.ts.
(function () {
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  // Each button's id is the message it sends (and the command the host runs).
  for (const id of ["newProject", "composeTop", "simulate"]) {
    byId(id).addEventListener("click", () => vscode.postMessage({ type: id }));
  }

  window.addEventListener("message", ({ data: msg }) => {
    if (msg.type === "activeModule") {
      render(msg);
    }
  });

  function makeSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  /** @param {{fileName: string | null, module: {name: string, ports: any[]} | null}} active */
  function render({ fileName, module }) {
    byId("activeSection").hidden = !module;
    byId("emptySection").hidden = Boolean(module);
    if (!module) {
      byId("emptySection").textContent = fileName ? `No module found in ${fileName}.` : "Open a .sv file to see it here.";
      return;
    }

    byId("moduleName").textContent = `module ${module.name}`;
    byId("fileName").textContent = fileName;
    byId("portList").replaceChildren(
      ...module.ports.map((port) => {
        const item = document.createElement("li");
        item.append(makeSpan(`dir ${port.direction}`, port.direction), makeSpan("port-name", port.name));
        if (port.width > 1) {
          item.appendChild(makeSpan("port-detail", `[${port.width - 1}:0]`));
        }
        if (port.resetPolarity) {
          item.appendChild(makeSpan("dir reset", `reset (${port.resetPolarity === "active-low" ? "low" : "high"})`));
        }
        return item;
      })
    );
  }

  vscode.postMessage({ type: "ready" });
})();
