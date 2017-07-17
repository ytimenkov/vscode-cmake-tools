import { assert } from "chai";
import { rmdir } from "../src/util";
import { Fixture, BackendFixture } from "./fixture";
import { ServerClientCMakeToolsFactory } from "../src/client";
import { BackendNewInitializationParams, CMakeToolsBackend } from "../src/backend";
import { Disposable } from "vscode";
import { CMakeGenerator } from "../src/api";
import { exists } from "../src/async";
import * as sinon from "Sinon";

sinon.assert.expose(assert, { prefix: '' });

/**
 * Generator which will be used in test.
 * Please adapt to the one available on your system when running test.
 */
const cmakeGenerator: CMakeGenerator = {
    name: 'Ninja'
}

/**
 * Set to true to reuse existing build directory in backend tests.
 * (Useful for debuggign tests).
 */
const quickSetup: boolean = true;

const is0To1Ratio = sinon.match((n) => (0 <= n && n <= 1), 'Number between 0 and 1');

suite('Backend: Unconfigured project', async function () {
    this.timeout(60 * 1000);

    const binaryDir: string = Fixture.resolvePath('test_project/build-new');
    const factory = new ServerClientCMakeToolsFactory();
    let backend: CMakeToolsBackend;

    const fixture = () => {
        return new BackendFixture(factory)
            .binaryDir(binaryDir)
            .generator(cmakeGenerator);
    }

    test('Initializes new project', async function () {
        backend = await fixture().initializeNew();

        assert.include(backend.sourceDir, 'test_project');
        assert.include(backend.binaryDir, 'build-new');
        assert.match(backend.generator.name, /\w+/);

        assert.isTrue(await backend.configure());

        const execTarget = backend.targets.find(t => t.name === 'MyExecutable');
        assert.isOk(execTarget, 'MyExecutable target should be reported');
    });

    test('Can specify environment and cache parameters', async function () {
        backend = await fixture()
            .env({ CMT_BACKEND_TEST_ENV_VAR: 'backend-test-env' })
            .initializeNew();

        const h = Fixture.createProgressHandler();

        assert.isTrue(await backend.configure(['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1'], h));

        sinon.assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1');
        sinon.assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_ENV_VAR=backend-test-env');
        sinon.assert.calledWithMatch(h.onProgress, 'Configuring', is0To1Ratio);
        sinon.assert.calledWithMatch(h.onProgress, 'Generating', is0To1Ratio);
    });

    teardown(async function () {
        if (backend) {
            await backend.dispose();
        }
        await rmdir(binaryDir);
    });
});

suite('Backend tests', async function () {
    this.timeout(60 * 1000);

    // Array of folders to clean up in tear down method.
    let disposables: Disposable[] = [];

    const factory = new ServerClientCMakeToolsFactory();
    const binaryDir: string = Fixture.resolvePath('test_project/build-backend');

    const fixture = () => {
        return new BackendFixture(factory)
            .registerInto(disposables)
            .binaryDir(binaryDir);
    }

    suiteSetup(async function () {
        if (quickSetup && await exists(binaryDir))
            return;

        const params: BackendNewInitializationParams = {
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
        const backend = await fixture().initializeConfigured();
        assert.include(backend.sourceDir, 'test_project');
    });

    test('Can configure with default args', async function () {
        const backend = await fixture().initializeConfigured();

        assert.isTrue(await backend.configure());

        const execTarget = backend.targets.find(t => t.name === 'MyExecutable');
        assert.isOk(execTarget, 'MyExecutable target should be reported');
        assert.propertyVal(execTarget, 'targetType', 'EXECUTABLE');
    });

    test('Configure reports progress messages', async function () {
        const backend = await fixture().initializeConfigured();

        const h = Fixture.createProgressHandler();
        assert.isTrue(await backend.configure(undefined, h));

        sinon.assert.calledWithMatch(h.onProgress, 'Configuring', is0To1Ratio);
        sinon.assert.calledWithMatch(h.onProgress, 'Generating', is0To1Ratio);
        sinon.assert.calledWithMatch(h.onMessage, 'Configuring done');
    });

    test('Can specify configure variable', async function () {
        const backend = await fixture().initializeConfigured();
        const h = Fixture.createProgressHandler();

        assert.isTrue(await backend.configure(['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1'], h));
        sinon.assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1');

        h.onMessage.reset();

        assert.isTrue(await backend.configure(['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backed-test-2'], h));
        sinon.assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_CONFIGURE_VAR=backed-test-2');
    });

    test('Can specify environment variable', async function () {
        assert.notProperty(process.env, 'CMT_BACKEND_TEST_ENV_VAR');

        const backend = await fixture()
            .env({ CMT_BACKEND_TEST_ENV_VAR: 'backend-test-env' })
            .initializeConfigured();
        const h = Fixture.createProgressHandler();

        assert.isTrue(await backend.configure(undefined, h));
        sinon.assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_ENV_VAR=backend-test-env');
    });

});