import { normalizePath } from "./util";
import { join } from "path";
import { ExecuteOptions, ExecutionResult } from "./api";

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

  static executeCMakeCommand(args: string[], options?: ExecuteOptions): Promise<ExecutionResult> {
    return Promise.reject(new Error("TODO"));
  }

}
