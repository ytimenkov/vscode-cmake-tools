import { CMakeToolsWrapper, UnconfiguredProjectError } from "../src/wrapper";
import { extensions } from "vscode";
import { assert, use } from "chai";
import chaiAsPromised = require("chai-as-promised");
import { rmdir } from "../src/util";
import { Fixture } from "./fixture";

use(chaiAsPromised);

suite.only('Smoke tests', () => {
    let cmt: CMakeToolsWrapper;

    // Array of folders to clean up in tear down method.
    let cleanupFolders: string[] = [];

    suiteSetup(async () => {
        const ext = await extensions.getExtension<CMakeToolsWrapper>('vector-of-bool.cmake-tools');
        if (!ext)
            throw new Error('Extension is unavailable');
        cmt = ext.exports;
    });

    setup(() => {
        cleanupFolders = [];
    });

    test('Loads unconfigured project', async () => {
        assert.include(await cmt.binaryDir, 'test_project');
        const state = cmt.model.state;
        assert.isDefined(state);
        assert.include(state!, 'Unconfigured');
    });

    teardown(async () => {
        cmt.model.buildDirectory = undefined;
        await assert.isRejected(cmt.backed, UnconfiguredProjectError);
        if (cleanupFolders.length > 0) {
            await Promise.all(cleanupFolders.map((path) => rmdir(path)));
        }
    });
});