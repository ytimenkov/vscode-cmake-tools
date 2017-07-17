
import { normalize, join } from "path";
import { Disposable } from "vscode";
import { CMakeToolsBackendFactory, CMakeToolsBackend, BackendConfiguredInitializationParams, ProgressHandler, BackendNewInitializationParams } from "../src/backend";
import { spy } from "sinon";
import { CMakeGenerator } from "../src/api";

const here = __dirname;

/**
 * A helper interface to create progress handler spies.
 */
export interface ProgressHandlerSpy extends ProgressHandler {
    onProgress: sinon.SinonSpy & ((message: string, progress: number) => void);
    onMessage: sinon.SinonSpy & ((message: string, title?: string) => void);
}

export class Fixture {
    static resolvePath(filename: string): string {
        return normalize(join(here, '../..', 'test', filename));
    }

    static createProgressHandler(): ProgressHandlerSpy {
        let progressHandler = {
            onProgress: (message: string, progress: number) => { },
            onMessage: (message: string, title?: string) => { }
        };
        spy(progressHandler, 'onProgress');
        spy(progressHandler, 'onMessage');
        return <ProgressHandlerSpy>progressHandler;
    }
}

/**
 * A test fixture to create backend.
 * Follows Fluent Builder pattern to make tests independent of constructors.
 */
export class BackendFixture {
    private _disposables?: Disposable[];
    private _binaryDir?: string;
    private _sourceDir?: string;
    private _generator?: CMakeGenerator;
    private _env?: { [key: string]: string };

    constructor(private factory: CMakeToolsBackendFactory) {
    }

    registerInto(disposables: Disposable[]): BackendFixture {
        this._disposables = disposables;
        return this;
    }

    binaryDir(dir: string): BackendFixture {
        this._binaryDir = dir;
        return this;
    }

    sourceDir(dir: string): BackendFixture {
        this._sourceDir = dir;
        return this;
    }

    env(environment?: { [key: string]: string }): BackendFixture {
        this._env = environment;
        return this;
    }

    generator(generator: CMakeGenerator): BackendFixture {
        this._generator = generator;
        return this;
    }

    async initializeConfigured(): Promise<CMakeToolsBackend> {
        let params: BackendConfiguredInitializationParams = {
            binaryDir: this._binaryDir || Fixture.resolvePath('test_project/build'),
            environment: this._env,
        };
        const backend = await this.factory.initializeConfigured(params);
        if (this._disposables) {
            this._disposables.push(backend);
        }
        return backend;
    }

    async initializeNew(): Promise<CMakeToolsBackend> {
        let params: BackendNewInitializationParams = {
            binaryDir: this._binaryDir || Fixture.resolvePath('test_project/build'),
            sourceDir: this._sourceDir || Fixture.resolvePath('test_project'),
            generator: this._generator || { name: 'Ninja' },
            environment: this._env,
        };
        const backend = await this.factory.initializeNew(params);
        if (this._disposables) {
            this._disposables.push(backend);
        }
        return backend;
    }
}
