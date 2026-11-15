import * as path from "path";
import * as vscode from "vscode";
import { listModulesInFolder } from "../generation/moduleLibrary";
import { backfillSteps, buildDefaultSteps } from "../simulation/defaultSteps";
import { simulate } from "../simulation/icarusRunner";
import { parseInstances } from "../simulation/instanceParser";
import { parseModule } from "../simulation/portParser";
import { ParsedModule, Port, PortDirection, SimStep, SimulationResult } from "../simulation/types";
import { DisposableWebviewPanel } from "./disposableWebviewPanel";
import { renderWebviewPage, webviewOptions } from "./webviewUtils";

/** A submodule instance as drawn on the Logical Schematic tab. */
interface SchematicInstance {
  instanceName: string;
  moduleType: string;
  ports: {
    name: string;
    /** Known only when the submodule's own source file sits in the same folder. */
    direction?: PortDirection;
    /** The expression wired to this port, as written. */
    net: string;
  }[];
}

interface ClientState {
  module: { name: string; ports: Port[] };
  steps: SimStep[];
  clockPeriodNs: number;
  hasClock: boolean;
  instances: SchematicInstance[];
}

/** Messages from media/main.js. */
type FromWebview =
  | { type: "ready" | "addCycle" | "rerun" }
  | { type: "setValue"; step: number; signal: string; value: string }
  | { type: "removeStep"; step: number };

type ToWebview =
  | { type: "init"; state: ClientState }
  | { type: "steps"; steps: SimStep[] }
  | { type: "status"; message: string; kind: "running" | "error" }
  | { type: "result"; result: SimulationResult };

const CLOCK_PERIOD_NS = 10;
// Collapses a burst of cell edits into one simulate() call. A run only
// takes ~15ms (see docs/toolchain-notes.md), so this isn't about slow
// runs: it avoids spawning iverilog+vvp for results about to be replaced.
const SET_VALUE_DEBOUNCE_MS = 150;

/**
 * The interactive simulator for one file: a timing diagram whose input
 * cells are editable (each edit re-runs Icarus Verilog), plus a read-only
 * Logical Schematic tab. One panel per document; saving the document
 * re-parses it and re-runs with the values already entered.
 */
export class SimulatorPanel extends DisposableWebviewPanel<ToWebview> {
  private static readonly panels = new Map<string, SimulatorPanel>();

  private steps: SimStep[];
  // Monotonic token so that if edits queue several simulations, a slow
  // earlier run can't overwrite the result of a newer one that finished
  // first (each simulate() call is an independent iverilog+vvp process).
  private simGeneration = 0;
  private setValueDebounce: ReturnType<typeof setTimeout> | undefined;

  static async show(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    defaultCycles: number
  ): Promise<void> {
    const key = document.uri.toString();
    const existing = SimulatorPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const module = parseModule(document.getText());
    if (!module) {
      void vscode.window.showErrorMessage(
        "Veriscode couldn't find a `module ... (...);` declaration to simulate in this file."
      );
      return;
    }
    if (module.ports.length === 0) {
      void vscode.window.showWarningMessage(`Module "${module.name}" has no ports - nothing to drive or observe.`);
    }

    const panel = vscode.window.createWebviewPanel(
      "veriscode.simulator",
      `Simulate: ${module.name}`,
      vscode.ViewColumn.Beside,
      { ...webviewOptions(context.extensionUri), retainContextWhenHidden: true }
    );
    SimulatorPanel.panels.set(key, new SimulatorPanel(context, panel, document, module, defaultCycles));
    panel.onDidDispose(() => SimulatorPanel.panels.delete(key));
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private readonly document: vscode.TextDocument,
    private module: ParsedModule,
    defaultCycles: number
  ) {
    super(panel);
    this.steps = buildDefaultSteps(module, Math.max(1, defaultCycles));
    this.panel.webview.html = renderWebviewPage(panel.webview, context.extensionUri, {
      title: "Veriscode Simulator",
      styles: ["base.css", "style.css"],
      scripts: ["schematicCanvas.js", "main.js"],
      body: SIMULATOR_BODY,
    });
    this.panel.webview.onDidReceiveMessage((msg: FromWebview) => this.handleMessage(msg));

    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === this.document.uri.toString()) {
        this.reparseAndRerun();
      }
    });
    this.panel.onDidDispose(() => {
      saveListener.dispose();
      clearTimeout(this.setValueDebounce);
    });
  }

  private clientState(): ClientState {
    return {
      module: { name: this.module.name, ports: this.module.ports },
      steps: this.steps,
      clockPeriodNs: CLOCK_PERIOD_NS,
      hasClock: this.module.ports.some((p) => p.isClockLike && p.direction === "input"),
      instances: this.schematicInstances(),
    };
  }

  /**
   * The module's submodule instances, with each port's direction looked up
   * from the submodule's own declaration when it lives in the same folder
   * (the same "sibling files" rule the simulator compiles by).
   */
  private schematicInstances(): SchematicInstance[] {
    const siblings = new Map(
      listModulesInFolder(path.dirname(this.document.uri.fsPath)).map(({ module }) => [module.name, module])
    );
    return parseInstances(this.module.sourceText).map((inst) => {
      const declared = siblings.get(inst.moduleType);
      return {
        instanceName: inst.instanceName,
        moduleType: inst.moduleType,
        ports: Object.entries(inst.connections).map(([name, net]) => ({
          name,
          direction: declared?.ports.find((p) => p.name === name)?.direction,
          net,
        })),
      };
    });
  }

  private async handleMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({ type: "init", state: this.clientState() });
        await this.runSimulation();
        break;
      case "setValue": {
        const step = this.steps[msg.step];
        if (step) {
          step[msg.signal] = msg.value;
          this.scheduleSimulation();
        }
        break;
      }
      case "addCycle":
        // A new column starts as a copy of the last one.
        this.steps.push({ ...this.steps[this.steps.length - 1] });
        this.post({ type: "steps", steps: this.steps });
        await this.runSimulation();
        break;
      case "removeStep":
        if (this.steps.length > 1) {
          this.steps.splice(msg.step, 1);
          this.post({ type: "steps", steps: this.steps });
          await this.runSimulation();
        }
        break;
      case "rerun":
        await this.runSimulation();
        break;
    }
  }

  private reparseAndRerun(): void {
    const reparsed = parseModule(this.document.getText());
    if (!reparsed) {
      this.post({ type: "status", message: "Module declaration not found after save.", kind: "error" });
      return;
    }
    this.module = reparsed;
    // Keep the values already entered for ports that still exist, drop
    // those for ports that are gone, and give any newly added input a
    // default so no step is left without a value for it.
    const portNames = new Set(reparsed.ports.map((p) => p.name));
    this.steps = this.steps.map((step) =>
      Object.fromEntries(Object.entries(step).filter(([name]) => portNames.has(name)))
    );
    backfillSteps(reparsed, this.steps);
    this.post({ type: "init", state: this.clientState() });
    void this.runSimulation();
  }

  /** Debounced entry point for high-frequency triggers (cell edits). */
  private scheduleSimulation(): void {
    clearTimeout(this.setValueDebounce);
    this.setValueDebounce = setTimeout(() => void this.runSimulation(), SET_VALUE_DEBOUNCE_MS);
  }

  private async runSimulation(): Promise<void> {
    const generation = ++this.simGeneration;
    this.post({ type: "status", message: "Simulating…", kind: "running" });
    const config = vscode.workspace.getConfiguration("veriscode.simulator");
    const result = await simulate(this.module, this.document.uri.fsPath, this.steps, CLOCK_PERIOD_NS, {
      extensionPath: this.context.extensionPath,
      iverilogOverride: config.get<string>("icarusPath"),
      vvpOverride: config.get<string>("vvpPath"),
    });
    // Drop this result if a newer simulation was kicked off while we ran -
    // its result is the one that matches the current steps/module state.
    if (generation === this.simGeneration) {
      this.post({ type: "result", result });
    }
  }
}

const SIMULATOR_BODY = `
  <h1 id="title"></h1>
  <p class="subtitle" id="subtitle"></p>

  <div class="tabs" role="tablist">
    <button class="tab" id="tabTiming" role="tab" aria-controls="timingView" aria-selected="true">Timing Diagram</button>
    <button class="tab" id="tabSchematic" role="tab" aria-controls="schematicView" aria-selected="false">Logical Schematic</button>
  </div>

  <section id="timingView" role="tabpanel">
    <div class="toolbar">
      <button id="addCycle">+ Cycle</button>
      <button class="secondary" id="rerun">Re-run</button>
      <span id="status" role="status"></span>
    </div>
    <pre id="errorLog" class="log" hidden></pre>
    <div class="diagram-scroll">
      <div class="diagram" id="diagram"></div>
    </div>
    <p class="legend">Click any input cell to type a value (e.g. 0, 1, x, 4'hA, 3'b101). Outputs update automatically.</p>
  </section>

  <section id="schematicView" role="tabpanel" hidden>
    <p class="legend" id="schematicLegend"></p>
    <div class="schematic-canvas" id="schematicCanvas"></div>
  </section>`;
