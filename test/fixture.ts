import { normalize, join } from "path";
import { Disposable } from "vscode";
import { CMakeToolsBackendFactory, CMakeToolsBackend, BackendConfiguredInitializationParams, ProgressHandler, BackendNewInitializationParams } from "../src/backend";
import { CMakeGenerator } from "../src/api";
import { ServerClientCMakeToolsFactory } from "../src/client";
import * as sinon from "Sinon";
import * as chai from "chai";

const here = __dirname;

// Augmentation of chai.assert module with sinon for convenience.
declare global {
    namespace Chai {
        interface Assert {
            calledWithMatch(spy: sinon.SinonSpy, ...args: any[]): void;
            calledWith(spy: sinon.SinonSpy, ...args: any[]): void;
            called(spy: sinon.SinonSpy): void;
        }
    }
}

sinon.assert.expose(chai.assert, { prefix: "" });

export { assert } from "chai";
export { stub, spy, match } from "sinon";

/**
 * A helper interface to create progress handler spies.
 */
export interface ProgressHandlerSpy extends ProgressHandler {
    onProgress: sinon.SinonSpy & ((message: string, progress: number) => void);
    onMessage: sinon.SinonStub & ((message: string, title?: string) => void);
}

export const is0To1Ratio = sinon.match((n) => (0 <= n && n <= 1), 'Number between 0 and 1');

export class Fixture {
    static resolvePath(filename: string): string {
        return normalize(join(here, '../..', 'test', filename));
    }

    static createProgressHandler(): ProgressHandlerSpy {
        let progressHandler = {
            onProgress: (message: string, progress: number) => { },
            onMessage: (message: string, title?: string) => { }
        };
        sinon.spy(progressHandler, 'onProgress');
        sinon.stub(progressHandler, 'onMessage');
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

    constructor(private factory: CMakeToolsBackendFactory = new ServerClientCMakeToolsFactory()) {
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
            generator: this._generator || TestEnv.cmakeGenerator,
            environment: this._env,
        };
        const backend = await this.factory.initializeNew(params);
        if (this._disposables) {
            this._disposables.push(backend);
        }
        return backend;
    }
}

/**
 * System where tests run.
 */
export class TestEnv {

    /**
     * Generator which will be used in test.
     * Please adapt to the one available on your system when running test.
     */
    static readonly cmakeGenerator: CMakeGenerator = {
        name: 'Ninja'
    }

    /**
     * Set to true to reuse existing build directory in backend tests.
     * (Useful for debugging tests).
     */
    static readonly quickSetup: boolean = true;
}