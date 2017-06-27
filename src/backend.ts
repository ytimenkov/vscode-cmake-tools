import * as vscode from 'vscode';

import { ExecutableTarget, Target, ExecutionResult, ExecuteOptions, CompilationInfo, VariantKeywordSettings } from './api';

// This is based on the API interface, but several async members are sync here
export interface CMakeToolsBackend extends vscode.Disposable {
  readonly sourceDir: string;
  readonly binaryDir: string;

  readonly diagnostics: vscode.DiagnosticCollection;

  readonly targets: Target[];

  readonly reconfigured: vscode.Event<void>;

  compilationInfoForFile(filepath: string): Promise<CompilationInfo | null>;

  configure(extraArgs?: string[], runPreBuild?: boolean): Promise<number>;
  build(target?: string): Promise<number>;
  install(): Promise<number>;
  jumpToCacheFile(): Promise<vscode.TextEditor | null>;
  clean(): Promise<number>;
  cleanConfigure(): Promise<number>;
  cleanRebuild(): Promise<number>;
  buildWithTarget(): Promise<number>;
  setDefaultTarget(): Promise<void>;
  setBuildType(): Promise<number>;
  ctest(): Promise<number>;
  stop(): Promise<boolean>;
  quickStart(): Promise<number>;
  launchTarget(): Promise<void>;
  debugTarget(): Promise<void>;
  launchTargetProgramPath(): Promise<string | null>;
  selectLaunchTarget(): Promise<string | null>;
  selectEnvironments(): Promise<void>;
  setActiveVariantCombination(settings: VariantKeywordSettings): Promise<void>;
  toggleCoverageDecorations(): void;
}

/**
 * Parameters used to initialize new build system.
 */
export interface ConfigureParams {
  sourceDir: string;
  binaryDir: string;
  generator: Generator;
  // TODO: Variant stuff.
  // TODO: extra cmake command-line parameters?
  settings?: { [key: string]: (string | number | boolean | string[]) };
}

/**
 * The interface for initializing backend promises.
 */
export interface CMakeToolsBackendFactory {
  initializeConfigured(binaryDir: string): Promise<CMakeToolsBackend>;
  initializeNew(params: ConfigureParams): Promise<CMakeToolsBackend>;
}
