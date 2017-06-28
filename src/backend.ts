import { Target, ExecutionResult, ExecuteOptions, CompilationInfo, VariantKeywordSettings, CMakeGenerator } from './api';
import { CancellationToken, Disposable, DiagnosticCollection, Event } from "vscode";

export type ProgressHandler = (number) => void;

/**
 * The backend API provides metadata for currently selected binary directory.
 */
export interface CMakeToolsBackend extends Disposable {
  readonly sourceDir: string;
  readonly binaryDir: string;

  readonly diagnostics: DiagnosticCollection;

  readonly targets: Target[];

  readonly reconfigured: Event<void>;

  readonly generator: CMakeGenerator;

  readonly noExecutablesMessage: string;

  compilationInfoForFile(filepath: string): Promise<CompilationInfo | null>;

  /**
   * Executes configure and generate operations on currently initialized binary
   * directory.
   */
  configure(extraArgs?: string[], progressHandler?: ProgressHandler, token?: CancellationToken): Promise<boolean>;

  /**
   * Builds specified target in the current build directory.
   * @param configuration is required for multi-configuration generators.
   */
  build(target?: string, configuration?: string, progressHandler?: ProgressHandler, token?: CancellationToken): Promise<boolean>;
}

/**
 * Parameters used to initialize new build system.
 */
export interface InitialConfigureParams {
  sourceDir: string;
  binaryDir: string;
  generator: CMakeGenerator;
  // TODO: Variant stuff.
  // TODO: extra cmake command-line parameters?
  settings?: { [key: string]: (string | number | boolean | string[]) };
}

/**
 * The interface for initializing backend promises.
 */
export interface CMakeToolsBackendFactory {
  initializeConfigured(binaryDir: string): Promise<CMakeToolsBackend>;
  initializeNew(params: InitialConfigureParams): Promise<CMakeToolsBackend>;
}
