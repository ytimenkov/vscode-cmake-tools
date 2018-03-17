import * as vscode from 'vscode';
import {Disposable} from 'vscode';

import {BasicTestResults} from './ctest';
import {Activity, Model} from './model';

interface Hideable {
  show(): void;
  hide(): void;
}

function setVisible<T extends Hideable>(i: T, v: boolean) {
  if (v) {
    i.show();
  } else {
    i.hide();
  }
}

export class StatusBar implements vscode.Disposable {
  private readonly _cmakeToolsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.5);
  private readonly _kitSelectionButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.45);
  private readonly _buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.4);
  private readonly _targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.3);
  private readonly _debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.25);
  private readonly _launchTargetNameButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.2);
  private readonly _testButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3.1);
  private readonly _warningMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);

  private disposables: Disposable[] = [
    this._cmakeToolsStatusItem,
    this._kitSelectionButton,
    this._buildButton,
    this._targetButton,
    this._launchTargetNameButton,
    this._testButton,
    this._warningMessage,
  ];

  dispose() {
    for (const item of this.disposables) {
      item.dispose();
    }
  }

  constructor(private _model: Model) {
    this._model.onDidChangeActivity(this._updateActivity, this, this.disposables);

    this._cmakeToolsStatusItem.command = 'cmake.setVariant';
    this._cmakeToolsStatusItem.tooltip = 'Click to select the current build variant';
    this._buildButton.command = 'cmake.build';
    this._kitSelectionButton.command = 'cmake.selectKit';
    this._kitSelectionButton.tooltip = 'Click to change the active kit';
    this._targetButton.command = 'cmake.setDefaultTarget';
    this._targetButton.tooltip = 'Set the active target to build';
    this._testButton.command = 'cmake.ctest';
    this._testButton.tooltip = 'Run CTest tests';
    this._debugButton.tooltip = 'Launch the debugger for the selected target';
    this._debugButton.command = 'cmake.debugTarget';
    this._launchTargetNameButton.command = 'cmake.selectLaunchTarget';
    this._launchTargetNameButton.tooltip = 'Select the target to launch';
    this._reloadBuildButton();
    this.reloadVisibility();
  }

  reloadVisibility() {
    const autovis_items = [
      this._cmakeToolsStatusItem,
      this._buildButton,
      this._kitSelectionButton,
      this._targetButton,
      this._debugButton,
      this._launchTargetNameButton,
    ];
    for (const item of autovis_items) {
      setVisible(item, this._visible && !!item.text);
    }
    setVisible(this._debugButton,
               this._visible && vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined
                   && !!this._debugButton.text);
  }

  /**
   * Whether the status bar items are visible
   */
  setVisible(v: boolean) {
    this._visible = v;
    this.reloadVisibility();
  }
  private _visible: boolean = true;

  private _reloadStatusButton() {
    this._cmakeToolsStatusItem.text = `CMake: ${this._projectName}: ${this._buildTypeLabel}`;
    this._cmakeToolsStatusItem.show();
  }

  private _reloadDebugButton() {
    if (!this._launchTargetNameButton.text) {
      this._debugButton.text = '$(bug)';
      this._launchTargetNameButton.hide();
    } else {
      this._debugButton.text = '$(bug) Debug';
      if (this._visible) {
        this._launchTargetNameButton.show();
      }
    }
    this.reloadVisibility();
  }

  /**
   * The name of the open project
   */
  private _projectName: string = 'Unconfigured Project';
  setProjectName(v: string) {
    this._projectName = v;
    this._reloadStatusButton();
  }

  /**
   * The build type label. Determined by the active build variant
   */
  private _buildTypeLabel: string = 'Unconfigured';
  setBuildTypeLabel(v: string) {
    this._buildTypeLabel = v;
    this._reloadStatusButton();
  }

  /**
   * The name of the currently active target to build
   */
  private _targetName: string;
  public get targetName(): string { return this._targetName; }
  public set targetName(v: string) {
    this._targetName = v;
    this._targetButton.text = `[${v}]`;
    this.reloadVisibility();
  }

  setLaunchTargetName(v: string) {
    this._launchTargetNameButton.text = v;
    this._reloadDebugButton();
  }

  private _ctestEnabled: boolean = false;
  public get ctestEnabled(): boolean { return this._ctestEnabled; }
  public set ctestEnabled(v: boolean) {
    this._ctestEnabled = v;
    setVisible(this._testButton, v);
  }


  private _testResults: BasicTestResults|null = null;
  public get testResults(): BasicTestResults|null { return this._testResults; }
  public set testResults(v: BasicTestResults|null) {
    this._testResults = v;

    if (!v) {
      this._testButton.text = 'Run CTest';
      this._testButton.color = '';
      return;
    }

    const passing = v.passing;
    const total = v.total;
    const good = passing == total;
    const icon = good ? 'check' : 'x';
    this._testButton.text = `$(${icon}) ${passing}/${total} ${total == 1 ? 'test' : 'tests'} passing`;
    this._testButton.color = good ? 'lightgreen' : 'yellow';
  }

  /** Reloads the content of the build button */
  private _reloadBuildButton() {
    const activity = this._model.activity;
    let text = '';
    if (activity) {
      if (activity.cts) {
        text = '$(x) ';
        this._buildButton.command = 'cmake.stop';
      } else {
        this._buildButton.command = undefined;
      }
      text += activity.name;
    } else {
      text = '$(gear) Build';
      this._buildButton.command = 'cmake.build';
    }

    const prog = this._progress;
    if (prog) {
      const bars = prog * 0.4 | 0;
      text += ` [${Array(bars).join('█')}${Array(40 - bars).join('░')}] ${prog}%`;
    }
    this._buildButton.text = text;
  }

  /**
   * The progress of the currently executing task. Updates a primitive progress
   * bar.
   */
  private _progress: number|null = null;
  setProgress(v: number|null) {
    this._progress = v;
    this._reloadBuildButton();
  }

  private _updateActivity(_prevActivity?: Activity) { this._reloadBuildButton(); }

  private _reloadKitsButton() {
    if (this._visible) {
      if (this._activeKitName.length) {
        this._kitSelectionButton.text = this._activeKitName;
      } else {
        this._kitSelectionButton.text = 'No Kit Selected';
      }
      this.reloadVisibility();
    } else {
      this._kitSelectionButton.hide();
    }
  }

  setActiveKitName(v: string) {
    this._activeKitName = v;
    this._reloadKitsButton();
  }
  private _activeKitName: string = '';

  showWarningMessage(msg: string) {
    this._warningMessage.color = 'yellow';
    this._warningMessage.text = `$(alert) ${msg}`;
    this._warningMessage.show();
    setTimeout(() => this._warningMessage.hide(), 5000);
  }
}