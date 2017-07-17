import { assert, use } from "chai";
import { rmdir } from "../src/util";
import { Fixture } from "./fixture";
import { ServerClientCMakeToolsFactory } from "../src/client";
import { InitialConfigureParams, CMakeToolsBackend, ProgressHandler } from "../src/backend";
import { Disposable } from "vscode";
import { CMakeGenerator } from "../src/api";
import { exists } from "../src/async";
import * as sinon from "Sinon";

sinon.assert.expose(assert, { prefix: "" });

/**
 * Generator which will be used in test.
 * Please adapt to the one available on your system when running test.
 */
const cmakeGenerator: CMakeGenerator = {
    name: "Ninja"
}

/**
 * Set to true to reuse existing build directory in backend tests.
 * (Useful for debuggign tests).
 */
const quickSetup: boolean = true;

const is0To1Ratio = sinon.match((n) => (0 <= n && n <= 1), "Number between 0 and 1");

suite('Backend: Unconfigured project', async function () {
    this.timeout(60 * 1000);

    const binaryDir: string = Fixture.resolvePath('test_project/build-new');
    const factory = new ServerClientCMakeToolsFactory();
    let backend: CMakeToolsBackend;

    test('Initializes new project', async function () {
        // TODO: Progress? test on progress?
        const params: InitialConfigureParams = {
            sourceDir: Fixture.resolvePath('test_project'),
            binaryDir: binaryDir,
            generator: cmakeGenerator
        };
        backend = await factory.initializeNew(params);

        assert.include(backend.sourceDir, 'test_project');
        assert.include(backend.binaryDir, 'build-new');
        assert.match(backend.generator.name, /\w+/);

        assert.isTrue(await backend.configure());

        const execTarget = backend.targets.find(t => t.name === 'MyExecutable');
        assert.isOk(execTarget, 'MyExecutable target should be reported');
    });

    teardown(async function () {
        if (backend) {
            await backend.dispose();
        }
        await rmdir(binaryDir);
    });
});

suite.only('Backend tests', async function () {
    this.timeout(60 * 1000);

    // Array of folders to clean up in tear down method.
    let disposables: Disposable[] = [];

    const factory = new ServerClientCMakeToolsFactory();
    const binaryDir: string = Fixture.resolvePath('test_project/build-backend');

    suiteSetup(async function () {
        if (quickSetup && await exists(binaryDir))
            return;

        const params: InitialConfigureParams = {
            sourceDir: Fixture.resolvePath('test_project'),
            binaryDir: binaryDir,
            generator: cmakeGenerator
        };
        const backend = await factory.initializeNew(params);
        try {
            assert.isTrue(await backend.configure());
        }
        finally {
            await backend.dispose();
        }
    });

    suiteTeardown(async function () {
        if (!quickSetup)
            await rmdir(binaryDir);
    });

    setup(function () {
        disposables = [];
    });

    teardown(async function () {
        if (disposables.length > 0) {
            await Promise.all(disposables.map(d => d.dispose()));
        }
    });

    test('Can open existing folder', async function () {
        const backend = await factory.initializeConfigured(binaryDir);
        disposables.push(backend);
        assert.include(backend.sourceDir, 'test_project');
    });

    test('Can configure with default args', async function () {
        const backend = await factory.initializeConfigured(binaryDir);
        disposables.push(backend);

        assert.isTrue(await backend.configure());

        const execTarget = backend.targets.find(t => t.name === 'MyExecutable');
        assert.isOk(execTarget, 'MyExecutable target should be reported');
    });

    test.only('Configure reports progress messages', async function () {
        const backend = await factory.initializeConfigured(binaryDir);
        disposables.push(backend);

        const progressHandler: ProgressHandler = {
            onProgress: (message: string, progress: number) => { },
            onMessage: (message: string, title?: string) => { }
        };
        const onProgress = sinon.spy(progressHandler, "onProgress");
        const onMessage = sinon.spy(progressHandler, "onMessage");

        assert.isTrue(await backend.configure(undefined, progressHandler));

        sinon.assert.calledWithMatch(onProgress, "Configuring", is0To1Ratio);
        sinon.assert.calledWithMatch(onProgress, "Generating", is0To1Ratio);
        sinon.assert.calledWithMatch(onMessage, "Configuring done");
    });

});