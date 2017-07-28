import { join } from "path";
import { Fixture, BackendFixture, assert, TestEnv, is0To1Ratio } from "./fixture";
import { exists, execute } from "../src/async";
import { rmdir } from "../src/util";
import { CMake } from "../src/cmake";
import { CancellationTokenSource } from "vscode";

suite('Build tests', function () {
    this.timeout(10 * 1000);

    const binaryDir: string = Fixture.resolvePath('test_project/build-build');

    async function configure(args: string[], environment?: { [key: string]: string }) {
        const backend = await (new BackendFixture()
            .binaryDir(binaryDir)
            .env(environment))
            .initializeConfigured();
        try {
            assert.isTrue(await backend.configure(args));
        } finally {
            await backend.dispose();
        }
    }

    suiteSetup(async function () {
        if (TestEnv.quickSetup && await exists(binaryDir))
            return;

        const fixture = new BackendFixture()
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

    setup(async function () {
        await configure([`-DCMT_BUILD_TEST_TIMESTAMP=${Math.random()}`]);
    });

    test('Can build project with default arguments', async function () {
        assert.isTrue(await CMake.build({ binaryDir }));

        const result = await execute(join(binaryDir, 'MyExecutable'), []);
        assert.strictEqual(result.retc, 0);
        assert.match(result.stdout, /Hello, CMake Tools!/);
    });

    test('Build reports progress and messages', async function () {
        const h = Fixture.createProgressHandler();

        assert.isTrue(await CMake.build({ binaryDir }, h));

        assert.calledWithMatch(h.onProgress, 'Building', is0To1Ratio);
        assert.calledWithMatch(h.onMessage, 'CMakeTools: Building top-level dir');
    });

    test('Failed build returns false and reports error', async function () {
        await configure([], { CAUSE_BUILD_ERROR: 'TRUE' });

        const h = Fixture.createProgressHandler();

        assert.isFalse(await CMake.build({ binaryDir }, h));
        assert.calledWithMatch(h.onMessage, /special-error-cookie asdfqwerty/);
    });

    test('Building non-existing target returns false', async function () {
        const h = Fixture.createProgressHandler();
        const target = 'ThisIsNotAnExistingTarget';
        assert.isFalse(await CMake.build({ binaryDir, target }, h));
        assert.calledWithMatch(h.onMessage, target);
    });

    test('Builds selected target', async function () {
        const h = Fixture.createProgressHandler();
        const target = 'SpecialTarget';
        assert.isTrue(await CMake.build({ binaryDir, target }, h));
        assert.calledWithMatch(h.onMessage, 'CMakeTools: Special Target');
    });

    test('Build can be cancelled', async function () {
        await configure([], { CAUSE_BUILD_HANG: 'TRUE' });

        const h = Fixture.createProgressHandler();
        const cts = new CancellationTokenSource();

        // Store essential calls status in variables because exception from
        // callback will be swallowed and generally it's a bad idea.
        let sleepFinished = false;
        let cancelCalled = false;

        h.onMessage.withArgs('Start sleep').callsFake(() => {
            cancelCalled = true;
            cts.cancel();
        });
        h.onMessage.withArgs('End sleep').callsFake(() => sleepFinished = true);
        assert.isFalse(await CMake.build({ binaryDir }, h, cts.token));

        assert.isTrue(cancelCalled, 'Did not attempt to cancel build');
        assert.isFalse(sleepFinished, 'Build ran to the end without cancelling');
    });

    test('Can specify build environment', async function () {
        const h = Fixture.createProgressHandler();
        const environment: { [key: string]: string } = {
            CMT_SPECIAL_BUILD_VAR: 'CMakeTools'
        };
        const target = 'PrintEnvironment';
        assert.isTrue(await CMake.build({ binaryDir, environment, target }, h));
        assert.calledWithMatch(h.onMessage, 'CMT_SPECIAL_BUILD_VAR=CMakeTools');
    });
});