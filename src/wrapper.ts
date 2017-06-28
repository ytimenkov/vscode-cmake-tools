'use strict';

import * as vscode from 'vscode';

import * as api from './api';
import * as legacy from './legacy';
import * as util from './util';
import * as async from './async';
import * as path from 'path';
import { config } from './config';
import { log } from './logging';
import { CMakeToolsBackend, CMakeToolsBackendFactory } from './backend';
import { CMake } from './cmake';
import { VariantManager } from "./variants";
import { EnvironmentManager } from './environment';
import { ServerClientCMakeToolsFactory } from './client';

class UnconfiguredProjectError extends global.Error {
  constructor() {
    super('The project is not configured');
  }
}

/**
 * Creates a backend promise which resolves to an unconfigured backend.
 * It does catch() to prevent VS Code from complaining about rejected promises.
 */
function createUnconfiguredBackend(): Promise<CMakeToolsBackend> {
  const result = Promise.reject(new UnconfiguredProjectError());
  result.catch(() => {});
  return result;
}

/**
 * The purpose of CMaketoolsWrapper is to hide which backend is being used at
 * any particular time behind a single API, such that we can invoke commands
 * on the wrapper, and the underlying implementation will be chosen based on
 * user configuration and platform
 */
export class CMakeToolsWrapper implements api.CMakeToolsAPI, vscode.Disposable {
  private _backend: Promise<CMakeToolsBackend> = createUnconfiguredBackend();

  private _cmakeServerWasEnabled = config.useCMakeServer;
  private _oldPreferredGenerators = config.preferredGenerators;
  private _oldGenerator = config.generator;
  private _cmakePath = config.cmakePath;
  private _configureEnvironment = config.configureEnvironment;

  constructor(private _ctx: vscode.ExtensionContext) {
    this.variants = new VariantManager(_ctx);
    this.environments = new EnvironmentManager();

    _ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async () => {
      const do_reload =
        (config.useCMakeServer !== this._cmakeServerWasEnabled) ||
        (config.preferredGenerators !== this._oldPreferredGenerators) ||
        (config.generator !== this._oldGenerator) ||
        (config.cmakePath !== this._cmakePath) ||
        (config.configureEnvironment !== this._configureEnvironment);
      this._cmakeServerWasEnabled = config.useCMakeServer;
      this._oldPreferredGenerators = config.preferredGenerators;
      this._oldGenerator = config.generator;
      this._cmakePath = config.cmakePath;
      this._configureEnvironment = config.configureEnvironment;
      if (do_reload) {
        await this.restart();
      }
    }));
  }

  /**
   * Disposable for this object.
   *
   * Shutdown the backend and dispose of the emitters
   */
  public async dispose() {
    await this.shutdown();
    this._reconfiguredEmitter.dispose();
    this._targetChangedEventEmitter.dispose();
  }

  /**
   * sourceDir: Promise<string>
   */
  private async _sourceDir(): Promise<string> {
    return (await this._backend).sourceDir;
  }
  get sourceDir(): Promise<string> {
    return this._sourceDir();
  }

  /**
   * mainListFile: Promise<string>
   */
  private async _mainListFile(): Promise<string> {
    const backend = await this._backend;
    return CMake.getMainListFile(backend.sourceDir);
  }
  get mainListFile(): Promise<string> {
    return this._mainListFile();
  }

  /**
   * binaryDir: Promise<string>
   */
  private async _binaryDir(): Promise<string> {
    return (await this._backend).binaryDir;
  }
  get binaryDir(): Promise<string> {
    return this._binaryDir();
  }

  /**
   * cachePath: Promise<string>
   */
  private async _cachePath(): Promise<string> {
    const backend = await this._backend;
    return CMake.getCachePath(backend.binaryDir);
  }
  get cachePath(): Promise<string> {
    return this._cachePath();
  }

  /**
   * executableTargets: Promise<ExecutableTarget[]>
   */
  private async _executableTargets(): Promise<api.ExecutableTarget[]> {
    const backend = await this._backend;
    return backend.targets.reduce<api.ExecutableTarget[]>(
      (acc, target) => {
        if (target.type === 'rich') {
          acc.push({ name: target.name, path: target.filepath });
        }
        return acc;
      }, []
    );
  }
  get executableTargets(): Promise<api.ExecutableTarget[]> {
    return this._executableTargets();
  }

  /**
   * diagnostics: Promise<DiagnosticCollection[]>
   */
  private async _diagnostics(): Promise<vscode.DiagnosticCollection> {
    return (await this._backend).diagnostics;
  }
  get diagnostics(): Promise<vscode.DiagnosticCollection> {
    return this._diagnostics();
  }

  /**
   * targets: Promise<Target[]>
   */
  private async _targets(): Promise<api.Target[]> {
    return (await this._backend).targets;
  }
  get targets(): Promise<api.Target[]> {
    return this._targets();
  }

  async executeCMakeCommand(args: string[], options?: api.ExecuteOptions): Promise<api.ExecutionResult> {
    return CMake.executeCMakeCommand(args, options);
  }

  async execute(program: string, args: string[], options?: api.ExecuteOptions):
    Promise<api.ExecutionResult> {
    // TODO:
    return Promise.reject(new Error("Not implemented"));
    //    return (await this._backend).execute(program, args, options);
  }

  async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo | null> {
    const backend = await this._backend;
    return backend.compilationInfoForFile(filepath);
  }

  async configure(extraArgs?: string[], runPrebuild?: boolean): Promise<number> {
    // TODO: Progress and cancellation.
    // TODO: This should really work for unconfigured project too.
    // Write test for it.
    const backend = await this._backend;
    const result = await backend.configure(extraArgs);
    return result ? 0 : 1;
  }

  async build(target?: string): Promise<number> {
    // TODO: Progress and cancellation.
    const backend = await this._backend;
    const result = await backend.build(target);
    return result ? 0 : 1;
  }

  async install(): Promise<number> {
    return this.build("install");
  }

  async jumpToCacheFile() {
    const cachePath = await this.cachePath;
    if (!(await async.exists(cachePath))) {
      const do_conf = !!(await vscode.window.showErrorMessage(
        'This project has not yet been configured.', 'Configure Now'));
      if (do_conf) {
        if (await this.configure() !== 0) return null;
      }
    }

    vscode.commands.executeCommand(
      'vscode.previewHtml', 'cmake-cache://' + this.cachePath,
      vscode.ViewColumn.Three, 'CMake Cache');

    return null;
  }

  async clean(): Promise<number> {
    return this.build("clean");
  }

  async cleanConfigure(): Promise<number> {
    // TODO: Write test that clean configure is available for an empty project.
    const backend = await this._backend;
    const binaryDir = backend.binaryDir;
    const cachePath = CMake.getCachePath(binaryDir);
    const cmakeFiles = path.join(binaryDir, 'CMakeFiles');
    if (await async.exists(cachePath)) {
      log.info(`[vscode] Removing ${cachePath}`);
      await async.unlink(cachePath);
    }
    if (await async.exists(cmakeFiles)) {
      log.info(`[vscode] Removing ${cmakeFiles}`);
      await util.rmdir(cmakeFiles);
    }
    return this.configure();
  }

  async cleanRebuild(): Promise<number> {
    // TODO: Test that short-circuit works. Or at least in normal way.
    const backend = await this._backend;
    const result = await backend.build("clean") && await backend.build();
    return result ? 0 : 1;
  }

  async buildWithTarget(): Promise<number> {
    // TODO: Maybe minimize trips to _backend.
    const target = await this.showTargetSelector();
    if (target === null || target === undefined) return -1;
    return await this.build(target);
  }

  async setDefaultTarget(): Promise<void> {
    const newTarget = await this.showTargetSelector();
    if (!newTarget) return;
    this.defaultBuildTarget = newTarget;

  }

  async setBuildType(): Promise<number> {
    // TODO: Handle changes in variant may required reconfigure.
    const changed = await this.variants.showVariantSelector();
    if (changed) {
      // Changing the build type can affect the binary dir
      // this._ctestController.reloadTests(
      //   this.sourceDir, this.binaryDir, this.selectedBuildType || 'Debug');
    }
    return 0;
  }

  async ctest(): Promise<number> {
    // TODO: re-integrate  CTest
    return 0;
  }

  async stop(): Promise<boolean> {
    // TODO:
    return true;
  }

  async quickStart(): Promise<number> {
    let exists: Boolean = false;
    try {
      // TODO: Should it be handled differently? If backed is initialized with some source dir
      // which is not config.sourceDirectory ? Just refuse as well?
      const backend = await this._backend;
      exists = await async.exists(CMake.getMainListFile(backend.sourceDir));
    } catch (error) {
      // It's perfectly fine to be unconfigured.
      if (!(error instanceof UnconfiguredProjectError)) {
        log.error(error);
        throw error;
      }
    }

    // TODO:get resolved source directory.
    const sourceDir = config.sourceDirectory;
    const newMainListFile = CMake.getMainListFile(sourceDir);

    exists = exists || await async.exists(newMainListFile);
    if (exists) {
      vscode.window.showErrorMessage(
        'This workspace already contains a CMakeLists.txt!');
      return -1;
    }

    const project_name = await vscode.window.showInputBox({
      prompt: 'Enter a name for the new project',
      validateInput: (value: string): string => {
        if (!value.length) return 'A project name is required';
        return '';
      },
    });
    if (!project_name) return -1;

    const target_type = (await vscode.window.showQuickPick([
      {
        label: 'Library',
        description: 'Create a library',
      },
      { label: 'Executable', description: 'Create an executable' }
    ]));

    if (!target_type) return -1;

    const type = target_type.label;

    const init = [
      'cmake_minimum_required(VERSION 3.0.0)',
      `project(${project_name} VERSION 0.0.0)`,
      '',
      'include(CTest)',
      'enable_testing()',
      '',
      {
        Library: `add_library(${project_name} ${project_name}.cpp)`,
        Executable: `add_executable(${project_name} main.cpp)`,
      }[type],
      '',
      'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
      'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
      'include(CPack)',
      '',
    ].join('\n');

    if (type === 'Library') {
      const mainCppPath = path.join(sourceDir, project_name + '.cpp');
      if (!(await async.exists(mainCppPath))) {
        await util.writeFile(mainCppPath, [
          '#include <iostream>',
          '',
          `void say_hello(){ std::cout << "Hello, from ${project_name}!\\n"; }`,
          '',
        ].join('\n'));
      }
    } else {
      const mainCppPath = path.join(sourceDir, 'main.cpp');
      if (!(await async.exists(mainCppPath))) {
        await util.writeFile(mainCppPath, [
          '#include <iostream>',
          '',
          'int main(int, char**)',
          '{',
          '   std::cout << "Hello, world!\\n";',
          '}',
          '',
        ].join('\n'));
      }
    }
    await util.writeFile(newMainListFile, init);
    const doc = await vscode.workspace.openTextDocument(newMainListFile);
    await vscode.window.showTextDocument(doc);
    return this.configure();
  }

  async debugTarget(): Promise<void> {
    // TODO: defaultLaunchTarget may need to be a promise, if we want to wait
    // until backend initializes.
    const backend = await this._backend;
    const target = this.defaultLaunchTarget;

    if (!target) {
      vscode.window.showErrorMessage("The launch target is not selected. Please select one.");
      return;
    }
    if (config.buildBeforeRun) {
      if (!await backend.build(target.name))
        return;
    }
  }

  async launchTarget(): Promise<void> {
    const backend = await this._backend;
    const target = this.defaultLaunchTarget;

    if (!target)
      return;

    if (config.buildBeforeRun) {
      if (!await backend.build(target.name))
        return;
    }

    const term = vscode.window.createTerminal(target.name, target.path);
    this._ctx.subscriptions.push(term);
    term.show();
  }

  async launchTargetProgramPath(): Promise<string | null> {
    // TODO: await on backend to wait for initialization.
    await this._backend;
    return this.defaultLaunchTarget ? this.defaultLaunchTarget.path : null;
  }

  async selectLaunchTarget(): Promise<string | null> {
    const backend = await this._backend;
    const executableTargets = await this.executableTargets;
    if (!executableTargets) {
      vscode.window.showWarningMessage(backend.noExecutablesMessage);
      return null;
    }

    interface ExecutableTargetQuickPickItem extends vscode.QuickPickItem {
      target: api.ExecutableTarget
    };

    const choices: ExecutableTargetQuickPickItem[] = executableTargets.map(e => ({
      label: e.name,
      description: '',
      detail: e.path,
      target: e,
    }));
    const chosen = await vscode.window.showQuickPick(choices);
    if (!chosen) {
      return null;
    }
    this.defaultLaunchTarget = chosen.target;
    return chosen.target.path;
  }

  async selectEnvironments(): Promise<void> {
    return this.environments.selectEnvironments();
  }

  async setActiveVariantCombination(settings: api.VariantKeywordSettings): Promise<void> {
    return this.variants.setActiveVariantCombination(settings);
  }

  toggleCoverageDecorations(): void {
    // TODO: ctest controller.
    // return (await this._backend).toggleCoverageDecorations();
  }

  private _reconfiguredEmitter = new vscode.EventEmitter<void>();
  readonly reconfigured = this._reconfiguredEmitter.event;

  /**
   * @brief The default target to build when no target is specified
   */
  private _targetChangedEventEmitter = new vscode.EventEmitter<void>();
  readonly targetChangedEvent = this._targetChangedEventEmitter.event;

  private _defaultBuildTarget?: string;
  public get defaultBuildTarget(): string | undefined {
    return this._defaultBuildTarget;
  }
  public set defaultBuildTarget(v: string | undefined) {
    this._defaultBuildTarget = v;
    // this._statusBar.targetName = v || this.allTargetName;
    this._targetChangedEventEmitter.fire();
  }

  private defaultLaunchTarget?: api.ExecutableTarget;

  public readonly variants: VariantManager;
  public readonly environments: EnvironmentManager;
  public backendFactory?: CMakeToolsBackendFactory;

  private async createBackendFactory(): Promise<CMakeToolsBackendFactory> {
    const version_ex = await util.execute(this._cmakePath, ['--version']).onComplete;
    if (version_ex.retc !== 0 || !version_ex.stdout) {
      throw new Error(`Bad CMake executable "${this._cmakePath}". Is it installed and a valid executable?`);
    }
    const versionStr = /cmake version (.*?)\r?\n/.exec(version_ex.stdout)![1];
    const version = util.parseVersion(versionStr);
    log.info(`Using CMake executable "${this._cmakePath}", version ${versionStr}`);
    if (config.useCMakeServer) {
      if (util.versionGreater(version, '3.7.1')) {
        return new ServerClientCMakeToolsFactory();
      }
      else {
        log.info(
          'CMake Server is not available with the current CMake executable. Please upgrade to CMake 3.7.2 or newer first.');
      }
    }
    throw new Error("Deal with legacy later :D");
  }

  async start(): Promise<void> {
    try {
      if (!this.backendFactory) {
        this.backendFactory = await this.createBackendFactory();
      }
      log.verbose('Starting CMake Tools backend');

      const binaryDir = this.getActiveBinaryDir();
      const cachePath = CMake.getCachePath(binaryDir);
      let exists = await async.exists(CMake.getCachePath(binaryDir));
      if (exists) {
        this._backend = this.backendFactory.initializeConfigured(binaryDir);
      }
      else {
        // TODO: initialize new.
      }

      const backend = await this._backend;
      backend.reconfigured(() => this._reconfiguredEmitter.fire(), backend.subscriptions);
    } catch (error) {
      log.error(error);
      // TODO: Is replacing backend with 'Unconfigured' promise needed?
      // rejection is handled here, just matter of proper shutdown...
      vscode.window.showErrorMessage(`CMakeTools extension was unable to initialize: ${error} [See output window for more details]`);
    }
  }

  async shutdown() {
    try {
      const backendPromise = this._backend;
      this._backend = createUnconfiguredBackend();

      const backend = await backendPromise;
      log.verbose('Shutting down CMake Tools backend');
      await backend.dispose();
      log.verbose('CMake Tools has been stopped');
    } catch (error) {
      if (!(error instanceof UnconfiguredProjectError)) {
        // Something really bad is happened here
        // or backend just failed to initialize.
        log.error(error);
      }
    }
  }

  async restart(): Promise<void> {
    log.verbose('Restarting CMake Tools backend');
    await this.shutdown();
    await this.start();
    log.verbose('Restart is complete');
  }

  /**
 * Shows a QuickPick containing the available build targets.
 */
  private async showTargetSelector(): Promise<string | null> {
    const targets = await this.targets;
    if (!targets.length) {
      return (await vscode.window.showInputBox({ prompt: 'Enter a target name' })) || null;
    } else {
      const choices = targets.map((t): vscode.QuickPickItem => {
        switch (t.type) {
          case 'rich': {
            return {
              label: t.name,
              description: t.targetType,
              detail: t.filepath,
            };
          }
          case 'named': {
            return {
              label: t.name,
              description: '',
            };
          }
        }
      });
      return vscode.window.showQuickPick(choices).then(
        sel => sel ? sel.label : null);
    }
  }

  private getActiveBinaryDir(): string {
    // TODO: binary dir might be read from variant also.
    const replacements: [string, string][] = [
      // ['${buildType}', this.selectedBuildType || '']
    ];

    const binaryDir = util.replaceVars(replacements.reduce(
      (accdir, [needle, what]) => util.replaceAll(accdir, needle, what), config.buildDirectory));
    return util.normalizePath(binaryDir);
  }
}
