import {DiagnosticCollection, Disposable, Event, TextEditor} from 'vscode';

export interface ExecutionResult {
  retc: number;
  stdout: string|null;
  stderr: string|null;
}

export interface ExecuteOptions {
  silent: boolean;
  environment: {[key: string]: string};
  collectOutput?: boolean;
  workingDirectory?: string;
}

export interface RawCompilationInfo {
  file: string;
  directory: string;
  command: string;
}

export interface CompilationInfo {
  file: string;
  compile?: RawCompilationInfo;
  includeDirectories: {path: string; isSystem: boolean;}[];
  compileDefinitions: {[define: string]: string | null};
  compileFlags: string[];
  compiler?: string;
}

export enum EntryType {
  Bool = 0,
  String = 1,
  Path = 2,
  FilePath = 3,
  Internal = 4,
  Uninitialized = 5,
  Static = 6,
}

export interface Test {
  id: number;
  name: string;
}

export interface CacheEntryProperties {
  type: EntryType;
  helpString: string;
  key: string;
  value: any;
  advanced: boolean;
}

export interface CacheEntry extends CacheEntryProperties { as<T>(): T; }

export interface ExecutableTarget {
  name: string;
  path: string;
}

export interface VariantKeywordSettings { [key: string]: string; }

export interface NamedTarget {
  type: 'named';
  name: string;
}

export interface RichTarget {
  type: 'rich';
  name: string;
  filepath: string;
  targetType: string;
}

export type Target = NamedTarget | RichTarget;

/**
 * A CMake generator used to configure project.
 */
export interface Generator {
  name: string;
  platform?: string;
  toolset?: string;
}

/**
 * A named set of system environment variables
 * used in every CMake command.
 */
export interface Environment {
  name: string;
  description?: string;
  mutex?: string;
  variables: Map<string, string>;
  preferredGenerator?: Generator;
}

export interface CMakeToolsAPI extends Disposable {
  // Get the root source directory
  readonly sourceDir: Promise<string>;
  // Get the main CMake File
  readonly mainListFile: Promise<string>;
  // Get the binary directory for the project
  readonly binaryDir: Promise<string>;
  // Get the path to the CMake cache
  readonly cachePath: Promise<string>;
  // Targets which are executable
  readonly executableTargets: Promise<ExecutableTarget[]>;
  // Diagnostics obtained from configure/build
  readonly diagnostics: Promise<DiagnosticCollection>;
  // Targets available for building
  readonly targets: Promise<Target[]>;
  // Event fired when configure completes
  readonly reconfigured: Event<void>;
  // Event fired when the default build target changes
  readonly targetChangedEvent: Event<void>;

  // Execute a command using the CMake executable
  executeCMakeCommand(args: string[], options?: ExecuteOptions): Promise<ExecutionResult>;
  // Execute an arbitrary program in the active environments
  execute(program: string, args: string[], options?: ExecuteOptions): Promise<ExecutionResult>;

  // Get the compilation information for a file
  compilationInfoForFile(filepath: string): Promise<CompilationInfo | null>;

  // Configure the project. Returns the return code from CMake.
  configure(extraArgs?: string[], runPreBuild?: boolean): Promise<number>;
  // Build the project. Returns the return code from the build
  build(target?: string): Promise<number>;
  // Install the project. Returns the return code from CMake
  install(): Promise<number>;
  // Open the CMake Cache file in a text editor
  jumpToCacheFile(): Promise<TextEditor | null>;
  // Clean the build output
  clean(): Promise<number>;
  // Remove cached build settings and rerun the configuration
  cleanConfigure(): Promise<number>;
  // Clean the build output and rebuild
  cleanRebuild(): Promise<number>;
  // Build a target selected by the user
  buildWithTarget(): Promise<number>;
  // Show a selector for the user to set the default build target
  setDefaultTarget(): Promise<void>;
  // Set the active build variant
  setBuildType(): Promise<number>;
  // Execute CTest
  ctest(): Promise<number>;
  // Stop the currently running build/configure/test/install process
  stop(): Promise<boolean>;
  // Show a quickstart
  quickStart(): Promise<number>;
  // Start the executable target without a debugger
  launchTarget(): Promise<void>;
  // Start the debugger with the selected build target
  debugTarget(): Promise<void>;
  // Get the path to the active debugging target
  launchTargetProgramPath(): Promise<string | null>;
  // Allow the user to select target to debug
  selectLaunchTarget(): Promise<string | null>;
  // Show the environment selection quickpick
  selectEnvironments(): Promise<void>;
  // Sets the variant based on keyword settings
  setActiveVariantCombination(settings: VariantKeywordSettings): Promise<void>;
  // Toggle code coverage view on/off
  toggleCoverageDecorations(): void;
}