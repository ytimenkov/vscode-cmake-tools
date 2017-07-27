import { normalizePath, execute2, mergeEnvironment } from "./util";
import { join } from "path";
import { ExecuteOptions, ExecutionResult } from "./api";
import { ProgressHandler } from "./backend";
import { CancellationToken } from "vscode";
import { SpawnOptions } from "child_process";

export interface CMakeBuildParams {
  binaryDir: string;

  /**
   * Extra environment set for build,
   * e.g. include and library paths for compiler.
   */
  environment?: { [key: string]: string };

  /**
   * Extra arguments to pass to cmake --build command.
   */
  buildArgs?: string[];

  /**
   * Extra arguments to passs to underlying make program.
   */
  buildToolArgs?: string[];

  /**
   * Target to build. Builds a default target if not specified.
   */
  target?: string;

  /**
   * Configuration to build. Required for multi-target generators.
   */
  configuration?: string;
}

/**
 * Utility functions to work with CMake.
 */
export class CMake {
  /**
   * @brief Get the path to the root CMakeLists.txt given the source dir.
   */
  static getMainListFile(sourceDir: string): string {
    const listfile = join(sourceDir, 'CMakeLists.txt');
    return normalizePath(listfile);
  }

  /**
   * @brief Get the path to the CMakeCache file in the build directory
   */
  static getCachePath(binaryDir: string): string {
    const file = join(binaryDir, 'CMakeCache.txt');
    return normalizePath(file);
  }

  /**
   * Resolves the name of 'all' build target for specified generator.
   * @param generator The generator name.
   */
  static getAllTargetName(generator: string) {
    return (/Visual Studio/.test(generator) || generator.toLowerCase().includes('xcode')) ? 'ALL_BUILD' : 'all';
  }


  static executeCMakeCommand(args: string[], options?: ExecuteOptions): Promise<ExecutionResult> {
    return Promise.reject(new Error("TODO"));
  }

  /**
   * Contains a valid path to CMake executable.
   */
  public static get path(): string {
    // TODO: add function to find CMake installation, or move this into some dynamic part of class.
    return 'cmake';
  }

  /**
  * Invokes cmake --build with specified parameters.
  */
  static async build(params: CMakeBuildParams, progressHandler?: ProgressHandler, token?: CancellationToken): Promise<boolean> {
    let args: string[] = [
      '--build',
      params.binaryDir,
    ];
    if (params.target) {
      args.push('--target', params.target);
    }
    if (params.configuration) {
      args.push('--config', params.configuration);
    }
    if (params.buildArgs) {
      args.push(...params.buildArgs);
    }
    args.push('--');
    if (params.buildToolArgs) {
      args.push(...params.buildToolArgs);
    }

    let options: SpawnOptions = {
      // We set NINJA_STATUS to force Ninja to use the format
      // that we would like to parse
      env: { NINJA_STATUS: '[%f/%t %p] ' }
    };
    if (params.environment) {
      options.env = mergeEnvironment(options.env, params.environment);
    }

    const { child, onComplete } = execute2(CMake.path, args, options, token);

    // Attach progress reporter to parse build output.
    if (progressHandler) {
      const percent_re = /\[.*?(\d+)\%.*?\]/;
      child.stdout.on('line', (line: string): void => {
        const res = percent_re.exec(line);
        if (res) {
          const procent = Math.floor(parseInt(res[1]) / 100);
          progressHandler.onProgress('Building', procent);
        }
        progressHandler.onMessage(line);
      });
      child.stderr.on('line', (line: string): void => {
        progressHandler.onMessage(line, 'Error');
      })
    }

    const result = await onComplete;
    return result === 0;
  }

}
