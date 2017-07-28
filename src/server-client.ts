import * as proc from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';

import { config } from './config';
import { log } from './logging';
import * as util from './util';
import { CMakeGenerator } from './api';
import { mergeEnvironment } from "./util";

const MESSAGE_WRAPPER_RE =
  /\[== "CMake Server" ==\[([^]*?)\]== "CMake Server" ==\]\s*([^]*)/;
type MessageType = ('hello' | 'handshake' | 'globalSettings' | 'setGlobalSettings' |
  'configure' | 'compute' | 'codemodel' | 'cmakeInputs' | 'cache' |
  'fileSystemWatchers' | 'reply' | 'error' | 'progress');

export class StartupError extends global.Error {
  constructor(public readonly retc: number) {
    super('Error starting up cmake-server');
  }
}

/**
 * Set this to true to see protocol exchange with CMake Server in the log.
 */
const logProtocolMessages = false;

export interface ProtocolVersion {
  isExperimental: boolean;
  major: number;
  minor: number;
}

/**
 * Summary of the message interfaces:
 *
 * There are interfaces for every type of message that may be sent to/from cmake
 * server. All messages derive from `MessageBase`, which has a single property
 * `type` to represent what type of message it is.
 *
 * Messages which are part of a request/response pair have an additional
 * attribute `cookie`. This is described by the `CookiedMessage` interface. All
 * messages that are part of a request/response pair derive from this interface.
 *
 * Each request/response message type is divided into the part describing its
 * content separate from protocol attributes, and the part describing its
 * protocol attributes.
 *
 * All reply messages derive from `ReplyMessage`, which defines the one
 * attribute `inReplyTo`.
 *
 * Request content interfaces are named with `<type>Request`, and encapsulate
 * the interesting content of the message. The message type corresponding to
 * that content is called `<type>Request`. The response content is
 * encoded in `<type>Content`, and the message is encoded with `<type>Reply`,
 * which inherits from `ReplyMessage` and `<type>Content`.
 */

/**
 * The base of all messages. Each message has a `type` property.
 */
export interface MessageBase { type: string; }

/**
 * Cookied messages represent some on-going conversation.
 */
export interface CookiedMessage extends MessageBase { cookie: string; }

/**
 * Reply messages are solicited by some previous request, which comes with a
 * cookie to identify the initiating request.
 */
export interface ReplyMessage extends CookiedMessage { inReplyTo: string; }

/**
 * Progress messages are sent regarding some long-running request process before
 * the reply is ready.
 */
export interface ProgressContent {
  progressMessage: string;
  progressMinimum: number;
  progressCurrent: number;
  progressMaximum: number;
}

interface ProgressMessage extends ProgressContent, ReplyMessage {
  type: 'progress';
}

/**
 * The `MessageMessage` is an un-solicited message from cmake with a string to
 * display to the user.
 */
export interface MessageContent {
  message: string;
  title: string;
}

interface MessageMessage extends MessageContent, ReplyMessage {
  type: 'message';
}
export interface SignalMessage extends MessageBase {
  type: 'signal';
  name: string;
}

export interface DirtyMessage extends SignalMessage { name: 'dirty'; }

export interface FileChangeMessage {
  name: 'fileChange'
  path: string;
  properties: string[];
}

type SomeSignalMessage = (DirtyMessage | FileChangeMessage);

/**
 * The hello message is sent immediately from cmake-server upon startup.
 */
export interface HelloMessage extends MessageBase {
  type: 'hello';
  supportedProtocolVersions: { major: number; minor: number; }[];
}

/**
 * Handshake is sent as the first thing from the client to set up the server
 * session. It should contain the chosen protocol version and some setup
 * information for the project.
 */
export interface HandshakeParams {
  sourceDirectory?: string;
  buildDirectory: string;
  generator?: string;
  extraGenerator?: string;
  platform?: string;
  toolset?: string;
  protocolVersion: { major: number; minor: number; };
}

export interface HandshakeRequest extends CookiedMessage, HandshakeParams {
  type: 'handshake';
}

export interface HandshakeContent { }

export interface HandshakeReply extends ReplyMessage, HandshakeContent {
  inReplyTo: 'handshake';
}

/**
 * GlobalSettings request gets some static information about the project setup.
 */
export interface GlobalSettingsParams { }

export interface GlobalSettingsRequest extends CookiedMessage,
  GlobalSettingsParams {
  type: 'globalSettings';
}

export interface GlobalSettingsContent {
  buildDirectory: string;
  capabilities: {
    generators: {
      extraGenerators: string[]; name: string; platformSupport: boolean;
      toolsetSupport: boolean;
    }[];
    serverMode: boolean;
    version: {
      isDirty: boolean; major: number; minor: number; patch: number;
      string: string;
      suffix: string;
    };
  };
  checkSystemVars: boolean;
  extraGenerator: string;
  generator: string;
  debugOutput: boolean;
  sourceDirectory: string;
  trace: boolean;
  traceExpand: boolean;
  warnUninitialized: boolean;
  warnUnused: boolean;
  warnUnusedCli: boolean;
}

export interface GlobalSettingsReply extends ReplyMessage,
  GlobalSettingsContent {
  inReplyTo: 'globalSettings';
}

/**
 * setGlobalSettings changes information about the project setup.
 */
export interface SetGlobalSettingsParams {
  checkSystemVars?: boolean;
  debugOutput?: boolean;
  trace?: boolean;
  traceExpand?: boolean;
  warnUninitialized?: boolean;
  warnUnused?: boolean;
  warnUnusedCli?: boolean;
}

export interface SetGlobalSettingsRequest extends CookiedMessage,
  SetGlobalSettingsParams {
  type: 'setGlobalSettings';
}

export interface SetGlobalSettingsContent { }

export interface SetGlobalSettingsReply extends ReplyMessage,
  SetGlobalSettingsContent {
  inReplyTo: 'setGlobalSettings';
}

/**
 * configure will actually do the configuration for the project. Note that
 * this should be followed shortly with a 'compute' request.
 */
export interface ConfigureParams { cacheArguments: string[]; }

export interface ConfigureRequest extends CookiedMessage, ConfigureParams {
  type: 'configure';
}

export interface ConfigureContent { }
export interface ConfigureReply extends ReplyMessage, ConfigureContent {
  inReplyTo: 'configure';
}

/**
 * Compute actually generates the build files from the configure step.
 */
export interface ComputeParams { }

export interface ComputeRequest extends CookiedMessage, ComputeParams {
  type: 'compute';
}

export interface ComputeContent { }

export interface ComputeReply extends ReplyMessage, ComputeContent {
  inReplyTo: 'compute';
}

/**
 * codemodel gets information about the project, such as targets, files,
 * sources,
 * configurations, compile options, etc.
 */
export interface CodeModelParams { }

export interface CodeModelRequest extends CookiedMessage, CodeModelParams {
  type: 'codemodel';
}

export interface CodeModelFileGroup {
  language: string;
  compileFlags: string;
  includePath?: { path: string; isSystem?: boolean; }[];
  defines?: string[];
  sources: string[];
}

export interface CodeModelTarget {
  name: string;
  type: ('STATIC_LIBRARY' | 'MODULE_LIBRARY' | 'SHARED_LIBRARY' | 'OBJECT_LIBRARY' |
    'EXECUTABLE' | 'UTILITY' | 'INTERFACE_LIBRARY');
  fullName: string;
  sourceDirectory: string;
  buildDirectory: string;
  artifacts: string[];
  linkerLanguage: string;
  linkLibraries: string[];
  linkFlags: string[];
  linkLanguageFlags: string[];
  frameworkPath: string;
  linkPath: string;
  sysroot: string;
  fileGroups: CodeModelFileGroup[];
}

export interface CodeModelProject {
  name: string;
  sourceDirectory: string;
  buildDirectory: string;
  targets: CodeModelTarget[];
}

export interface CodeModelConfiguration {
  name: string;
  projects: CodeModelProject[];
}

export interface CodeModelContent {
  configurations: CodeModelConfiguration[];
}

export interface CodeModelReply extends ReplyMessage, CodeModelContent {
  inReplyTo: 'codemodel';
}

/**
 * cmakeInputs will respond with a list of file paths that can alter a
 * projects configuration output. Editting these will cause the configuration to
 * go out of date.
 */
export interface CMakeInputsParams { }

export interface CMakeInputsRequest extends CookiedMessage, CMakeInputsParams {
  type: 'cmakeInputs';
}

export interface CMakeInputsContent {
  buildFiles: { isCMake: boolean; isTemporary: boolean; sources: string[]; }[];
  cmakeRootDirectory: string;
  sourceDirectory: string;
}

export interface CMakeInputsReply extends ReplyMessage, CMakeInputsContent {
  inReplyTo: 'cmakeInputs';
}

/**
 * The cache request will respond with the contents of the CMake cache.
 */
export interface CacheParams { }

export interface CacheRequest extends CookiedMessage, CacheParams {
  type: 'cache'
}

export interface CacheContent { cache: CMakeCacheEntry[]; }

export interface CMakeCacheEntry {
  key: string;
  properties: { ADVANCED: '0' | '1'; HELPSTRING: string };
  type: string;
  value: string;
}

export interface CacheReply extends ReplyMessage, CacheContent {
  inReplyTo: 'cache';
}

// Union type that represents any of the request types.
export type SomeRequestMessage =
  (HandshakeRequest | GlobalSettingsRequest | SetGlobalSettingsRequest |
    ConfigureRequest | ComputeRequest | CodeModelRequest | CacheRequest);

// Union type that represents a response type
export type SomeReplyMessage =
  (HandshakeReply | GlobalSettingsReply | SetGlobalSettingsReply |
    ConfigureReply | ComputeReply | CodeModelReply | CacheReply);

export type SomeMessage =
  (SomeReplyMessage | SomeRequestMessage | ProgressMessage | ErrorMessage |
    MessageMessage | HelloMessage | SignalMessage);

/**
 * The initial parameters when setting up the CMake client. The client init
 * routines will automatically perform the server handshake and set the
 * the appropriate settings. This is also where callbacks for progress and
 * message handlers are set.
 */
export interface ClientInit {
  cmakePath: string;
  onDirty: () => Promise<void>;
  environment: { [key: string]: string };
  sourceDir: string;
  binaryDir: string;
  generator?: CMakeGenerator;
}

interface ClientInitPrivate extends ClientInit {
  onHello: (m: HelloMessage) => Promise<void>;
  onCrash: (retc: number, signal: string) => Promise<void>;
  tmpdir: string;
}

/**
 * Error message represent something going wrong.
 */
export interface ErrorMessage extends CookiedMessage {
  type: 'error';
  errorMessage: string;
  inReplyTo: string;
}

export class ServerError extends global.Error implements ErrorMessage {
  type: 'error';
  constructor(
    e: ErrorMessage, public errorMessage = e.errorMessage,
    public cookie = e.cookie, public inReplyTo = e.inReplyTo) {
    super(e.errorMessage);
  }
  toString(): string {
    return `[cmake-server] ${this.errorMessage}`;
  }
}

export type ProgressHandler = (msg: ProgressContent) => void;
export type MessageHandler = (msg: MessageContent) => void;

interface MessageResolutionCallbacks {
  resolve: (a: SomeReplyMessage) => void;
  reject: (b: ServerError) => void;
  progress?: ProgressHandler;
  message?: MessageHandler;
}


export class CMakeServerClient {
  private _proc: proc.ChildProcess;
  private _accInput: string = '';
  private _promisesResolvers: Map<string, MessageResolutionCallbacks> = new Map;
  private _params: ClientInitPrivate;
  private _endPromise: Promise<void>;
  private _pipe: net.Socket;

  private _onMoreData(data: Uint8Array) {
    const str = data.toString();
    this._accInput += str;
    while (1) {
      const input = this._accInput;
      let mat = MESSAGE_WRAPPER_RE.exec(input);
      if (!mat) {
        break;
      }
      const [_all, content, tail] = mat;
      if (!_all || !content || tail === undefined) {
        debugger;
        throw new global.Error(
          'Protocol error talking to CMake! Got this input: ' + input);
      }
      this._accInput = tail;
      if (logProtocolMessages)
        console.log(`Received message from cmake-server: ${content}`);
      const message: SomeMessage = JSON.parse(content);
      this._onMessage(message);
    }
  }

  private _onMessage(some: SomeMessage): void {
    switch (some.type) {
      case 'hello': {
        this._params.onHello(some as HelloMessage).catch(e => {
          console.error('Unhandled error in onHello', e);
        });
        return;
      }
      case 'signal': {
        const sig = some as SomeSignalMessage;
        switch (sig.name) {
          case 'dirty': {
            this._params.onDirty().catch(e => {
              console.error('Unhandled error in onDirty', e);
            });
            return;
          }
          case 'fileChange': {
            return;
          }
        }
      }
    }
    if ('cookie' in some) {
      const cookied = some as CookiedMessage;
      const handler = this._promisesResolvers.get(cookied.cookie);
      if (!handler) {
        log.verbose(`Received message with invalid cookie: ${cookied}, msg: ${JSON.stringify(some)}`);
        return;
      }
      switch (some.type) {
        case 'reply': {
          const reply = cookied as SomeReplyMessage;
          this._promisesResolvers.delete(cookied.cookie);
          handler.resolve(reply);
          return;
        }
        case 'error': {
          const err = new ServerError(cookied as ErrorMessage);
          this._promisesResolvers.delete(cookied.cookie);
          handler.reject(err);
          return;
        }
        case 'progress': {
          if (handler.progress) {
            const prog = cookied as ProgressMessage;
            try {
              handler.progress(prog);
            } catch (e) {
              console.error('Unandled error in onProgress', e);
            }
          }
          return;
        }
        case 'message': {
          if (handler.message) {
            const msg = cookied as MessageMessage;
            try {
              handler.message(msg);
            } catch (e) {
              console.error('Unhandled error in onMessage', e);
            }
          }
          return;
        }
      }
    }

    debugger;
    console.warn(`Can't yet handle the ${some.type} messages`);
  }

  sendRequest(t: 'handshake', p: HandshakeParams, progress?: ProgressHandler, message?: MessageHandler): Promise<HandshakeContent>;
  sendRequest(t: 'globalSettings', p?: GlobalSettingsParams, progress?: ProgressHandler, message?: MessageHandler):
    Promise<GlobalSettingsContent>;
  sendRequest(t: 'setGlobalSettings', p: SetGlobalSettingsParams, progress?: ProgressHandler, message?: MessageHandler):
    Promise<SetGlobalSettingsContent>;
  sendRequest(t: 'configure', p: ConfigureParams, progress?: ProgressHandler, message?: MessageHandler): Promise<ConfigureContent>;
  sendRequest(t: 'compute', p?: ComputeParams, progress?: ProgressHandler, message?: MessageHandler): Promise<ComputeContent>;
  sendRequest(t: 'codemodel', p?: CodeModelParams, progress?: ProgressHandler, message?: MessageHandler): Promise<CodeModelContent>;
  sendRequest(T: 'cache', p?: CacheParams, progress?: ProgressHandler, message?: MessageHandler): Promise<CacheContent>;
  sendRequest(type: MessageType, params: any = {}, progress?: ProgressHandler, message?: MessageHandler): Promise<any> {
    const cookie = Math.random().toString();
    const pr = new Promise((resolve, reject) => {
      this._promisesResolvers.set(cookie, { resolve, reject, progress, message });
    });
    const cp = { ...params, type, cookie };
    const msg = JSON.stringify(cp);
    if (logProtocolMessages)
      console.log(`Sending message to cmake-server: ${msg}`);
    this._pipe.write('\n[== "CMake Server" ==[\n');
    this._pipe.write(msg);
    this._pipe.write('\n]== "CMake Server" ==]\n');
    return pr;
  }

  setGlobalSettings(params: SetGlobalSettingsParams): Promise<SetGlobalSettingsContent> {
    return this.sendRequest('setGlobalSettings', params);
  }

  getCMakeCacheContent(): Promise<CacheContent> {
    return this.sendRequest('cache');
  }

  getGlobalSettings(): Promise<GlobalSettingsContent> {
    return this.sendRequest('globalSettings');
  }

  configure(params: ConfigureParams, progress?: ProgressHandler, message?: MessageHandler): Promise<ConfigureContent> {
    return this.sendRequest('configure', params, progress, message);
  }

  compute(params?: ComputeParams, progress?: ProgressHandler, message?: MessageHandler): Promise<ComputeParams> {
    return this.sendRequest('compute', params, progress, message);
  }

  codemodel(params?: CodeModelParams): Promise<CodeModelContent> {
    return this.sendRequest('codemodel', params);
  }

  private _onErrorData(data: Uint8Array) {
    log.error(`[cmake-server] ${data.toString()}`);
  }

  public async shutdown() {
    this._pipe.end();
    await this._endPromise;
  }

  private constructor(params: ClientInitPrivate) {
    this._params = params;
    let pipe_file = path.join(params.tmpdir, '.cmserver-pipe');
    if (process.platform === 'win32') {
      pipe_file = '\\\\?\\pipe\\' + pipe_file;
    } else {
      pipe_file = path.join(params.binaryDir, `.cmserver.${process.pid}`);
    }
    const final_env = mergeEnvironment(process.env, params.environment);
    const child = this._proc = proc.spawn(
      params.cmakePath,
      ['-E', 'server', '--experimental', `--pipe=${pipe_file}`], {
        env: final_env,
      });
    log.info(`Started new CMake Server instance with PID ${child.pid}`);
    child.stdout.on('data', this._onErrorData.bind(this));
    child.stderr.on('data', this._onErrorData.bind(this));
    setTimeout(() => {
      const end_promise = new Promise(resolve => {
        const pipe = this._pipe = net.createConnection(pipe_file);
        pipe.on('data', this._onMoreData.bind(this));
        pipe.on('error', (_) => {
          debugger;
          pipe.end();
        });
        pipe.on('end', () => {
          pipe.end();
          resolve();
        });
      });
      const exit_promise = new Promise(resolve => {
        child.on('exit', () => {
          resolve();
        });
      });
      this._endPromise = <Promise<void>>Promise.all([end_promise, exit_promise]);
      this._proc = child;
      child.on('close', (retc: number, signal: string) => {
        if (retc !== 0) {
          log.error("The connection to cmake-server was terminated unexpectedly");
          log.error(`cmake-server exited with status ${retc} (${signal})`);
          params.onCrash(retc, signal).catch(e => {
            log.error(`Unhandled error in onCrash ${e}`);
          });
        }
      });
    }, 1000);
  }

  public static async start(params: ClientInit): Promise<CMakeServerClient> {
    let resolved = false;
    const tmpdir = path.join(vscode.workspace.rootPath!, '.vscode');
    // Ensure the binary directory exists
    await util.ensureDirectory(params.binaryDir);
    return new Promise<CMakeServerClient>((resolve, reject) => {
      const client = new CMakeServerClient({
        tmpdir,
        sourceDir: params.sourceDir,
        binaryDir: params.binaryDir,
        cmakePath: params.cmakePath,
        environment: params.environment,
        onDirty: params.onDirty,
        generator: params.generator,
        onCrash: async (retc) => {
          if (!resolved) {
            reject(new StartupError(retc));
          }
        },
        onHello: async (msg: HelloMessage) => {
          // We've gotten the hello message. We need to commense handshake
          try {
            let hsparams: HandshakeParams = {
              buildDirectory: params.binaryDir,
              protocolVersion: msg.supportedProtocolVersions[0],
              sourceDirectory: params.sourceDir
            };
            const generator = params.generator;
            if (generator) {
              hsparams.generator = generator.name;
              hsparams.platform = generator.platform;
              hsparams.toolset = generator.toolset || config.toolset || undefined;
            }

            await client.sendRequest('handshake', hsparams);
            resolved = true;
            resolve(client);
          } catch (e) {
            resolved = true;
            reject(e);
          }
        },
      });
    });
  }
}

export function createCooke(): string {
  return 'cookie-' + Math.random().toString();
}
