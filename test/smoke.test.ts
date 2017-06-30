import { CMakeToolsWrapper } from "../src/wrapper";
import { extensions } from "vscode";
import { assert } from "chai";

suite.only("Smoke tests", () => {
    let cmt: CMakeToolsWrapper;
    setup(async () => {
        const ext = await extensions.getExtension<CMakeToolsWrapper>('vector-of-bool.cmake-tools');
        if (!ext)
            throw new Error("Extension is unavailable");
        cmt = ext.exports;
    });

    test("Loads unconfigured project", async () => {
        assert.include(await cmt.binaryDir, "test_project");
        const state = cmt.model.state;
        assert.isDefined(state);
        assert.include(state!, "Unconfigured");
    });

    teardown(() => {

    });
});