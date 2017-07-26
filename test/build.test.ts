import { join } from "path";
import { Fixture, BackendFixture, assert, TestEnv, is0To1Ratio } from "./fixture";
import { exists, execute } from "../src/async";
import { rmdir } from "../src/util";
import { CMake, CMakeBuildParams } from "../src/cmake";

suite('Build tests', function() {
    this.timeout(10 * 1000);

    const binaryDir: string = Fixture.resolvePath('test_project/build-build');

    async function configure(args: string[]) {
        const backend = await (new BackendFixture()
            .binaryDir(binaryDir))
            .initializeConfigured();
        try {
            assert.isTrue(await backend.configure(args));
        } finally {
            await backend.dispose();
        }
    }

    suiteSetup(async function() {
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

    suiteTeardown(async function() {
        if (!TestEnv.quickSetup)
            await rmdir(binaryDir);
    });

    setup(async function() {
        await configure([`-DCMT_BUILD_TEST_TIMESTAMP=${Math.random()}`]);
    });

    test('Can build project with default arguments', async function() {
        const params: CMakeBuildParams = {
            binaryDir
        };

        assert.isTrue(await CMake.build(params));

        const result = await execute(join(binaryDir, 'MyExecutable'), []);
        assert.strictEqual(result.retc, 0);
        assert.match(result.stdout, /Hello, CMake Tools!/);
    });

    test('Build reports progress', async function() {
        const params: CMakeBuildParams = {
            binaryDir
        };

        const h = Fixture.createProgressHandler();

        assert.isTrue(await CMake.build(params, h));

        assert.calledWithMatch(h.onProgress, 'Building', is0To1Ratio);
    });
});