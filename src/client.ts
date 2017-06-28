'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

import * as api from './api';
import * as diagnostics from './diagnostics';
import * as async from './async';
import * as cache from './cache';
import * as util from './util';
import * as common from './common';
import { config } from './config';
import * as cms from './server-client';
import { log } from './logging';
import { CMakeToolsBackend, CMakeToolsBackendFactory, InitialConfigureParams, ProgressHandler } from './backend';
import { CancellationToken } from 'vscode';
import { CMake } from './cmake'

export class ServerClientCMakeTools implements CMakeToolsBackend {
  readonly  noExecutablesMessage: string = 'No targets are available for debugging.';
  // TODO: Initialize these.
  sourceDir: string;
  binaryDir: string;
  diagnostics: vscode.DiagnosticCollection;
  generator: api.CMakeGenerator;

  private _globalSettings: cms.GlobalSettingsContent;
  private _dirty = true;
  private _cacheEntries = new Map<string, cache.Entry>();
  private _accumulatedMessages: string[] = [];

  /**
   * The primary build output channel. We use the ThrottledOutputChannel because
   * large volumes of output can make VSCode choke
   */
  private readonly _channel = new util.ThrottledOutputChannel('CMake/Build');

  private constructor(public client: cms.CMakeServerClient) {
  }

  public static async create(client: cms.CMakeServerClient): Promise<ServerClientCMakeTools> {
    // TODO: Handle initialization failure. Do we need to dispose?
    const backend = new ServerClientCMakeTools(client);
    // await super._init();
    // await this._restartClient();
    backend._globalSettings = await client.getGlobalSettings();
    // this.codeModel = this._workspaceCacheContent.codeModel || null;
    // this._statusBar.statusMessage = 'Ready';
    // this._statusBar.isBusy = false;
    // if (this.executableTargets.length > 0) {
    //   this.currentLaunchTarget = this.executableTargets[0].name;
    // }
    try {
      await backend._refreshAfterConfigure();
    } catch (e) {
      if (e instanceof cms.ServerError) {
        // Do nothing
      } else {
        throw e;
      }
    }
    return backend;
  }

  private _codeModel: null | cms.CodeModelContent;
  public get codeModel() {
    return this._codeModel;
  }
  public set codeModel(cm: null | cms.CodeModelContent) {
    this._codeModel = cm;
    // if (cm && cm.configurations.length && cm.configurations[0].projects.length) {
    //   this._statusBar.projectName = cm.configurations[0].projects[0].name;
    // } else {
    //   this._statusBar.projectName = 'No Project';
    // }
    // this._writeWorkspaceCacheContent();
  }

  async dispose() {
    await this.dangerousShutdownClient();
  }

  private _reconfiguredEmitter = new vscode.EventEmitter<void>();
  public get reconfigured() { return this._reconfiguredEmitter.event; }

  get executableTargets() {
    return this.targets.filter(t => t.targetType === 'EXECUTABLE')
      .map(t => ({
        name: t.name,
        path: t.filepath,
      }));
  }

  public markDirty() {
    this._dirty = true;
  }

  get compilerId() {
    for (const lang of ['CXX', 'C']) {
      const entry = this.cacheEntry(`CMAKE_${lang}_COMPILER`);
      if (!entry) {
        continue;
      }
      const compiler = entry.as<string>();
      if (compiler.endsWith('cl.exe')) {
        return 'MSVC';
      } else if (/g(cc|\+\+)[^/]*/.test(compiler)) {
        return 'GNU';
      } else if (/clang(\+\+)?[^/]*/.test(compiler)) {
        return 'Clang';
      }
    }
    return null;
  }

  get needsReconfigure() {
    return this._dirty;
  }

  get activeGenerator() {
    return this._globalSettings ? this._globalSettings.generator : null;
  }

  allCacheEntries(): api.CacheEntryProperties[] {
    return Array.from(this._cacheEntries.values()).map(e => ({
      type: e.type,
      key: e.key,
      value: e.value,
      advanced: e.advanced,
      helpString:
      e.helpString,
    }));
  }

  cacheEntry(key: string) {
    return this._cacheEntries.get(key) || null;
  }

  async dangerousShutdownClient() {
    if (this.client) {
      await this.client.shutdown();
      // this.client = undefined;
    }
  }

  async compilationInfoForFile(filepath: string):
    Promise<api.CompilationInfo | null> {
    if (!this.codeModel) {
      return null;
    }
    const config = this.codeModel.configurations[0];
    // const config = this.codeModel.configurations.length === 1 ?
    // this.codeModel.configurations[0] :
    // this.codeModel.configurations.find(
    //   c => c.name === this.selectedBuildType);
    if (!config) {
      return null;
    }
    for (const project of config.projects) {
      for (const target of project.targets) {
        for (const group of target.fileGroups) {
          const found = group.sources.find(source => {
            const abs_source = path.isAbsolute(source) ?
              source :
              path.join(target.sourceDirectory, source);
            const abs_filepath = path.isAbsolute(filepath) ?
              filepath :
              path.join(this.sourceDir, filepath);
            return util.normalizePath(abs_source) ===
              util.normalizePath(abs_filepath);
          });
          if (found) {
            const defs = (group.defines || []).map(util.parseCompileDefinition);
            const defs_o = defs.reduce((acc, el) => {
              acc[el[0]] = el[1];
              return acc;
            }, {});
            return {
              file: found,
              compileDefinitions: defs_o,
              compileFlags: util.splitCommandLine(group.compileFlags),
              includeDirectories:
              (group.includePath ||
                [
                ]).map(p => ({ path: p.path, isSystem: p.isSystem || false })),
            };
          }
        }
      }
    }
    return null;
  }

  async configure(extraArgs?: string[], progressHandler?: ProgressHandler, token?: CancellationToken): Promise<boolean> {
    // TODO: Preconfigure did this:
    // 1. Check that some operation is already running.
    // 2. Check that folder is initialized and offered to QuickStart
    // 3. Initialized build type, if variant is not chosen.

    // if (!await this._preconfigure()) {
    //   return -1;
    // }

    // Pre-build checked that files are dirty and offerred to save all.
    // Also cleared output channel.
    // if (runPreBuild) {
    //   if (!await this._prebuild()) {
    //     return -1;
    //   }
    // }

    // PrepareConfigure initialized parameters, created initial cache file.

    // const args = await this.prepareConfigure();

    // this.statusMessage = 'Configuring...';

    const parser = new diagnostics.BuildParser(
      this.binaryDir, ['cmake'], this.activeGenerator);

    const parseMessages = () => {
      for (const msg of this._accumulatedMessages) {
        const lines = msg.split('\n');
        for (const line of lines) {
          parser.parseLine(line);
        }
      }
      parser.fillDiagnosticCollection(this.diagnostics);
    };

    try {
      this._accumulatedMessages = [];
      const args = extraArgs || [];
      await this.client.configure({ cacheArguments: args });
      await this.client.compute();
      parseMessages();
    } catch (e) {
      if (e instanceof cms.ServerError) {
        parseMessages();
        // TODO:
        // this._channel.appendLine(`[vscode] Configure failed: ${e}`);
        return false;
      } else {
        throw e;
      }
    }
    // TODO: isn't it better rely on notifications we get from CMake Server?
    await this._refreshAfterConfigure();
    this._reconfiguredEmitter.fire();
    return true;
  }

  async build(target?: string, configuration?: string, progressHandler?: ProgressHandler, token?: CancellationToken): Promise<boolean> {
    // TODO: some stuff in common.ts does pre-requisite checks.
    // TODO:
    return true;
  }

  get targets(): api.RichTarget[] {
    type Ret = api.RichTarget[];
    if (!this.codeModel) {
      return [];
    }
    const config = this.codeModel.configurations[0];
    // if (!config) {
    //   log.error(
    //     `Found no matching codemodel config for active build type ${this.selectedBuildType}`);
    //   return [];
    // }
    return config.projects.reduce<Ret>(
      (acc, project) => acc.concat(project.targets
        // Filter out targets with no build dir/filename, such as INTERFACE targets
        .filter(t => !!t.buildDirectory && !!t.artifacts)
        .map(
        t => ({
          type: 'rich' as 'rich',
          name: t.name,
          filepath: path.normalize(t.artifacts[0]),
          targetType: t.type,
        }))),
      [{
        type: 'rich' as 'rich',
        name: CMake.getAllTargetName(this.generator.name),
        filepath: 'A special target to build all available targets',
        targetType: 'META'
      }]);
  }

  protected async _refreshAfterConfigure() {
    return Promise.all([this._refreshCacheEntries(), this._refreshCodeModel()]);
  }

  private async _refreshCodeModel() {
    this.codeModel = await this.client.codemodel();
  }

  private async _refreshCacheEntries() {
    const clcache = await this.client.getCMakeCacheContent();
    return this._cacheEntries = clcache.cache.reduce((acc, el) => {
      const type: api.EntryType = {
        BOOL: api.EntryType.Bool,
        STRING: api.EntryType.String,
        PATH: api.EntryType.Path,
        FILEPATH: api.EntryType.FilePath,
        INTERNAL: api.EntryType.Internal,
        UNINITIALIZED: api.EntryType.Uninitialized,
        STATIC: api.EntryType.Static,
      }[el.type];
      console.assert(type !== undefined, `Unknown cache type ${el.type}`);
      acc.set(
        el.key, new cache.Entry(
          el.key, el.value, type, el.properties.HELPSTRING,
          el.properties.ADVANCED === '1'));
      return acc;
    }, new Map<string, cache.Entry>());
  }
}

export class ServerClientCMakeToolsFactory implements CMakeToolsBackendFactory {
  async initializeConfigured(binaryDir: string): Promise<CMakeToolsBackend> {
    // Work-around: CMake Server checks that CMAKE_HOME_DIRECTORY
    // in the cmake cache is the same as what we provide when we
    // set up the connection. Because CMake may normalize the
    // path differently than we would, we should make sure that
    // we pass the value that is specified in the cache exactly
    // to avoid causing CMake server to spuriously fail.

    // While trying to fix issue above CMake broke ability to run
    // with an empty sourceDir, so workaround because necessary for
    // different CMake versions.
    // See
    // https://gitlab.kitware.com/cmake/cmake/issues/16948
    // https://gitlab.kitware.com/cmake/cmake/issues/16736
    const cachePath = CMake.getCachePath(binaryDir);
    const tmpcache = await cache.CMakeCache.fromPath(cachePath);
    const sourceDir = tmpcache.get('CMAKE_HOME_DIRECTORY');
    if (!sourceDir) {
      throw new Error(`CMAKE_HOME_DIRECTORY is not found int the ${cachePath}. Project is not properly configured`);
    }

    const client = await cms.CMakeServerClient.start({
      binaryDir: binaryDir,
      sourceDir: sourceDir.as<string>(),
      cmakePath: config.cmakePath,
      environment: util.mergeEnvironment(
        config.environment,
        config.configureEnvironment/*,
          this.currentEnvironmentVariables*/),
      onDirty: async () => {
        // this._dirty = true;
      },
      onMessage: async (msg) => {
        // const line = `-- ${msg.message}`;
        // this._accumulatedMessages.push(line);
        // this._channel.appendLine(line);
      },
      onProgress: async (prog) => {
        // this.buildProgress = (prog.progressCurrent - prog.progressMinimum) /
        //   (prog.progressMaximum - prog.progressMinimum);
        // this.statusMessage = prog.progressMessage;
      },
      pickGenerator: () => Promise.resolve(null),
    });

    return this.createBackend(client);
  }

  async initializeNew(params: InitialConfigureParams): Promise<CMakeToolsBackend> {
    const client = await cms.CMakeServerClient.start({
      binaryDir: params.binaryDir,
      sourceDir: params.sourceDir,
      cmakePath: config.cmakePath,
      environment: util.mergeEnvironment(
        config.environment,
        config.configureEnvironment/*,
          this.currentEnvironmentVariables*/),
      onDirty: async () => {
        // this._dirty = true;
      },
      onMessage: async (msg) => {
        // const line = `-- ${msg.message}`;
        // this._accumulatedMessages.push(line);
        // this._channel.appendLine(line);
      },
      onProgress: async (prog) => {
        // this.buildProgress = (prog.progressCurrent - prog.progressMinimum) /
        //   (prog.progressMaximum - prog.progressMinimum);
        // this.statusMessage = prog.progressMessage;
      },
      pickGenerator: () => Promise.resolve(params.generator),
    });
    return this.createBackend(client);
  }

  private async createBackend(client: cms.CMakeServerClient): Promise<CMakeToolsBackend> {
    try {
      return await ServerClientCMakeTools.create(client);
    } catch (error) {
      log.error(`Backend failed to initialize: ${error}. Shutting down client`);
      await client.shutdown();
      throw error;
    }
  }

}