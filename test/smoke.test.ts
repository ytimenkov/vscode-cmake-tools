import { CMakeToolsWrapper, UnconfiguredProjectError } from "../src/wrapper";
import { extensions } from "vscode";
import { assert, use } from "chai";
import chaiAsPromised = require("chai-as-promised");
import { rmdir } from "../src/util";
import { Fixture } from "./fixture";

use(chaiAsPromised);

suite('Integration tests', async function () {
    this.timeout(60 * 1000);

    let cmt: CMakeToolsWrapper;

    // Array of folders to clean up in tear down method.
    let cleanupFolders: string[] = [];

    suiteSetup(async function () {
        const ext = await extensions.getExtension<CMakeToolsWrapper>('vector-of-bool.cmake-tools');
        if (!ext)
            throw new Error('Extension is unavailable');
        cmt = ext.exports;
    });

    setup(function () {
        cleanupFolders = [];
    });

    test('Loads unconfigured project', async function () {
        cmt.model.buildDirectory = Fixture.resolvePath("test_project/build");
        assert.include(await cmt.binaryDir, 'test_project');
        const state = cmt.model.state;
        assert.isDefined(state);
        assert.include(state!, 'Unconfigured');
    });

    test('Can configure new project with default settings', async function () {
        const buildDir = Fixture.resolvePath("test_project/build");
        cleanupFolders.push(buildDir);

        cmt.model.buildDirectory = buildDir;
        await assert.eventually.equal(cmt.configure(), 0);
        // TODO: check that project name is TestProject
        //await assert.eventually.equal(cmt.model.)
        assert.include(await cmt.sourceDir, "test_project");
        assert.equal(await cmt.binaryDir, buildDir);
        assert.include(await cmt.mainListFile, "test_project/CMakeLists.txt");
    });

    teardown(async function () {
        cmt.model.buildDirectory = undefined;

        // This waits until backend is shut down before removing build directory.
        await assert.isRejected(cmt.backend, UnconfiguredProjectError);
        if (cleanupFolders.length > 0) {
            await Promise.all(cleanupFolders.map((path) => rmdir(path)));
        }
    });
});