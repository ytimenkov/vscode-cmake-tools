import { Target, ExecutionResult, ExecuteOptions, CompilationInfo, VariantKeywordSettings, CMakeGenerator } from './api';
import { CancellationToken, Disposable, DiagnosticCollection, Event } from "vscode";

/**
 * Progress handler for long-running operations.
 */
export interface ProgressHandler {
  /**
   * Called when operation progress is updated.
   * @param message is the operation name.
   * @param progress the operation progress in range [0, 1].
   */
  onProgress: (message: string, progress: number) => void;

  /**
   * Called when operation emits diagnostic message.
   */
  onMessage: (message: string, title?: string) => void;
}

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

  /**
   * An array to which disposables can be added. When the
   * backend is deactivated the disposables will be disposed.
   */
  subscriptions: Disposable[];

  compilationInfoForFile(filepath: string): Promise<CompilationInfo>;

  /**
   * Executes configure and generate operations on currently initialized binary
   * directory.
   */
  configure(extraArgs?: string[], progressHandler?: ProgressHandler): Promise<boolean>;

  /**
   * Builds specified target in the current build directory.
   * @param configuration is required for multi-configuration generators.
   */
  build(target?: string, configuration?: string, progressHandler?: ProgressHandler, token?: CancellationToken): Promise<boolean>;
}

/**
 * Parameters used to initialize backend with build directory
 * containing configured project.
 */
export interface BackendConfiguredInitializationParams {
  binaryDir: string;
  environment?: { [key: string]: string };
}

/**
 * Parameters used to initialize new build system.
 */
export interface BackendNewInitializationParams extends BackendConfiguredInitializationParams {
  sourceDir: string;
  generator: CMakeGenerator;
  extraArgs?: string[];
}

/**
 * The interface for initializing backend promises.
 */
export interface CMakeToolsBackendFactory {
  initializeConfigured(params: BackendConfiguredInitializationParams): Promise<CMakeToolsBackend>;
  initializeNew(params: BackendNewInitializationParams): Promise<CMakeToolsBackend>;
}
