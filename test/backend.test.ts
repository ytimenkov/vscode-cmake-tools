import { assert, use } from "chai";
import chaiAsPromised = require("chai-as-promised");
import { rmdir } from "../src/util";
import { Fixture } from "./fixture";
import { ServerClientCMakeToolsFactory } from "../src/client";
import { InitialConfigureParams, CMakeToolsBackend } from "../src/backend";
import { Disposable } from "vscode";
import { CMakeGenerator } from "../src/api";

use(chaiAsPromised);

/**
 * Generator which will be used in test.
 * Please adapt to the one available on your system when running test.
 */
const cmakeGenerator: CMakeGenerator = {
    name: "Ninja"
}

suite.only('Backend tests', async function () {
    this.timeout(60 * 1000);

    // Array of folders to clean up in tear down method.
    let cleanupFolders: string[] = [];
    let disposables: Disposable[] = [];

    const factory = new ServerClientCMakeToolsFactory();

    setup(function () {
        cleanupFolders = [];
        disposables = [];
    });

    test('Initializes new project', async function () {
        // TODO: Progress? test on progress?
        const params: InitialConfigureParams = {
            sourceDir: Fixture.resolvePath('test_project'),
            binaryDir: Fixture.resolvePath('test_project/build-new'),
            generator: cmakeGenerator
        };
        cleanupFolders.push(params.binaryDir);
        const backend = await factory.initializeNew(params);
        disposables.push(backend);

        assert.include(backend.sourceDir, 'test_project');
        assert.include(backend.binaryDir, 'build-new');
        assert.match(backend.generator.name, /\w+/);

        assert.isTrue(await backend.configure());

        const execTarget = backend.targets.find(t => t.name === 'MyExecutable');
        assert.isOk(execTarget, 'MyExecutable target should be reported');
    });

    teardown(async function () {
        if (disposables.length > 0) {
            await Promise.all(disposables.map(d => d.dispose()));
        }
        if (cleanupFolders.length > 0) {
            await Promise.all(cleanupFolders.map((path) => rmdir(path)));
        }
    });
});