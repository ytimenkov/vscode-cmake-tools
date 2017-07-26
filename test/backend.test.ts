import { rmdir } from "../src/util";
import { Fixture, BackendFixture, TestEnv, is0To1Ratio, assert, spy } from "./fixture";
import { ServerClientCMakeToolsFactory } from "../src/client";
import { BackendNewInitializationParams, CMakeToolsBackend } from "../src/backend";
import { Disposable } from "vscode";
import { exists, execute } from "../src/async";
import { CMake } from "../src/cmake";

/**
 * Running test for unconfigured project is 10 times slower than
 * for configured one, therefore it's better to keep this suite small.
 */
suite('Backend: Unconfigured project', function () {
    this.timeout(60 * 1000);

    const binaryDir: string = Fixture.resolvePath('test_project/build-new');
    const factory = new ServerClientCMakeToolsFactory();
    let backend: CMakeToolsBackend;

    const fixture = () => {
        return new BackendFixture(factory)
            .binaryDir(binaryDir);
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

        assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1');
        assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_ENV_VAR=backend-test-env');
        assert.calledWithMatch(h.onProgress, 'Configuring', is0To1Ratio);
        assert.calledWithMatch(h.onProgress, 'Generating', is0To1Ratio);
    });

    teardown(async function () {
        if (backend) {
            await backend.dispose();
        }
        await rmdir(binaryDir);
    });
});

suite('Backend tests', function () {
    this.timeout(60 * 1000);

    // Array of folders to clean up in tear down method.
    let disposables: Disposable[] = [];

    const factory = new ServerClientCMakeToolsFactory();
    const binaryDir: string = Fixture.resolvePath('test_project/build-backend');

    function fixture() {
        return new BackendFixture(factory)
            .registerInto(disposables)
            .binaryDir(binaryDir);
    }

    suiteSetup(async function () {
        if (TestEnv.quickSetup && await exists(binaryDir))
            return;

        const fixture = new BackendFixture(factory)
            .binaryDir(binaryDir);

        const backend = await fixture.initializeNew();
        try {
            assert.isTrue(await backend.configure());
        }
        finally {
            await backend.dispose();
        }
    });

    suiteTeardown(async function () {
        if (!TestEnv.quickSetup)
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
        assert.match(backend.generator.name, /\w+/);
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

        assert.calledWithMatch(h.onProgress, 'Configuring', is0To1Ratio);
        assert.calledWithMatch(h.onProgress, 'Generating', is0To1Ratio);
        assert.calledWithMatch(h.onMessage, 'Configuring done');
    });

    test('Can specify configure variable', async function () {
        const backend = await fixture().initializeConfigured();
        const h = Fixture.createProgressHandler();

        assert.isTrue(await backend.configure(['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1'], h));
        assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-1');

        h.onMessage.reset();

        assert.isTrue(await backend.configure(['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backed-test-2'], h));
        assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_CONFIGURE_VAR=backed-test-2');
    });

    test('Can specify environment variable', async function () {
        assert.notProperty(process.env, 'CMT_BACKEND_TEST_ENV_VAR');

        const backend = await fixture()
            .env({ CMT_BACKEND_TEST_ENV_VAR: 'backend-test-env' })
            .initializeConfigured();
        const h = Fixture.createProgressHandler();

        assert.isTrue(await backend.configure(undefined, h));
        assert.calledWithMatch(h.onMessage, 'CMT_BACKEND_TEST_ENV_VAR=backend-test-env');
    });

    test('Disposes subscriptions', async function () {
        const backend = await fixture().initializeConfigured();
        let disposable = {
            dispose: () => { }
        };
        const disposeSpy = spy(disposable, 'dispose');
        backend.subscriptions.push(disposable);

        await backend.dispose();

        assert.called(disposeSpy);
    });

    test('Can get compilation info', async function () {
        const backend = await fixture().initializeConfigured();
        assert.isTrue(await backend.configure());

        const info = await backend.compilationInfoForFile(Fixture.resolvePath('test_project/main.cpp'));

        assert.isOk(info);
        assert.isAbove(info.compileFlags.length, 0);
        assert.include(info.file.toLocaleLowerCase(), 'main.cpp');
    });

    test('Configure emits event', async function () {
        const backend = await fixture().initializeConfigured();
        const onReconfigured = spy();
        backend.reconfigured(onReconfigured);

        assert.isTrue(await backend.configure());

        assert.called(onReconfigured);
    });

    /**
     * It would be nice to detect when cmake update build system in response to
     * changes in the files, e.g. during the build, but:
     *  1) This would normally work only for CMake >= 3.9
     *  2) It will be necessary to recompute again.
     */
    test.skip('External reconfigure emits event', async function () {
        const backend = await fixture().initializeConfigured();
        assert.isTrue(await backend.configure(['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-configured']));

        const onReconfigured = spy();
        backend.reconfigured(onReconfigured);

        // NOTE: Other way would be to spawn another backend...
        const res = await execute(CMake.path, ['-DCMT_BACKEND_TEST_CONFIGURE_VAR=backend-test-reconfigured', '.'],
            { cwd: binaryDir });
        assert.strictEqual(res.retc, 0, `Re-configure failed. Error:\n${res.stderr}\nOutput:\n${res.stdout}`);

        assert.called(onReconfigured);
    });

    test('Failed configure returns false', async function () {
        const backend = await fixture()
            .env({ CAUSE_CONFIG_ERROR: 'TRUE' })
            .initializeConfigured();
        const h = Fixture.createProgressHandler();

        assert.isFalse(await backend.configure(undefined, h));

        assert.calledWithMatch(h.onMessage, 'Injected failure');
    });
});
