import * as path from 'path';
import * as fs from 'fs';

import * as assert from 'assert';

import * as vscode from 'vscode';

import * as api from '../src/api';
import * as wrapper from '../src/wrapper';
import * as util from '../src/util';
import * as async from '../src/async';

import * as rimraf from 'rimraf';
import { Fixture } from "./fixture";

async function getExtension(): Promise<wrapper.CMakeToolsWrapper> {
    const cmt = vscode.extensions.getExtension<wrapper.CMakeToolsWrapper>('vector-of-bool.cmake-tools');
    if (!cmt) {
        return Promise.reject("Extension doesn't exist");
    }
    return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}


function smokeTests(context, tag, setupHelper) {
    context.timeout(60 * 1000); // These tests are slower than just unit tests
    let cmt: wrapper.CMakeToolsWrapper;
    setup(async function () {
        await setupHelper();
        cmt = await getExtension();
        await cmt.setActiveVariantCombination({
            buildType: 'debug'
        });
        const bd = await cmt.binaryDir;
        const exists = await new Promise<boolean>(resolve => {
            fs.exists(bd, resolve);
        });
        // Pause before starting each test. There is trouble on NTFS because
        // removing files doesn't actually remove them, which can cause
        // spurious test failures when we are rapidly adding/removing files
        // in the build directory
        await util.pause(1000);
        await new Promise(resolve => exists ? rimraf(bd, resolve) : resolve());
    });
    test(`Can execute CTest tests [${tag}]`, async function () {
        const retc = await cmt.ctest();
        assert.strictEqual(retc, 0);
    });
    test(`CMake Diagnostic Parsing [${tag}]`, async function () {
        const retc = await cmt.configure(['-DWARNING_COOKIE=this-is-a-warning-cookie']);
        assert.strictEqual(retc, 0);
        const diags: vscode.Diagnostic[] = [];
        (await cmt.diagnostics).forEach((d, diags_) => diags.push(...diags_));
        assert.strictEqual(diags.length, 1);
        const diag = diags[0];
        assert.strictEqual(diag.source, 'CMake (message)');
        assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Warning);
        assert(diag.message.includes('this-is-a-warning-cookie'));
    });
    test(`Compile Error Parsing [${tag}]`, async function () {
        const config_retc = await cmt.configure(['-DCAUSE_BUILD_ERROR=TRUE']);
        assert.strictEqual(config_retc, 0);
        const build_retc = await cmt.build();
        assert.notStrictEqual(build_retc, 0);
        const diags: vscode.Diagnostic[] = [];
        (await cmt.diagnostics).forEach((_d, diags_) => diags.push(...diags_));
        assert.strictEqual(diags.length, 1);
        const diag = diags[0];
        // These lines are hardcoded purposefully. They are one less than
        // the displayed line number in the main.cpp in the test_project
        assert.strictEqual(diag.range.start.line, 6);
        assert.strictEqual(diag.range.end.line, 6);
        assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Error);
        assert(diag.message.includes('special-error-cookie asdfqwerty'));
    });
    test(`Pass arguments to debugger [${tag}]`, async function () {
        const retc = await cmt.build();
        assert.strictEqual(retc, 0);
        const outfile = Fixture.resolvePath('output-file.txt');
        const test_string = 'ceacrybuhksrvniruc48o7dvz';
        await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
            args: [
                '--write-file', outfile,
                '--content', test_string,
            ]
        });
        await util.pause(1000);
        await cmt.debugTarget();
        // Debugging doesn't wait for it to finish. We must pause for a
        // while
        await util.pause(1000);
        const content = (await async.readFile(outfile)).toString();
        assert.strictEqual(content, test_string);
    });
    test(`Debugger gets environment variables [${tag}]`, async function () {
        const retc = await cmt.build();
        assert.strictEqual(retc, 0);
        const homedir_varname = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
        const homedir_var = process.env[homedir_varname];
        const outfile = Fixture.resolvePath('output-file.txt');
        await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
            args: [
                '--write-file', outfile,
                '--env', homedir_varname,
            ]
        });
        await util.pause(1000);
        await cmt.debugTarget();
        await util.pause(1000);
        const content = (await async.readFile(outfile)).toString();
        assert.strictEqual(content, homedir_var);
    });
    test(`Debugger gets custom environment variables [${tag}]`, async function () {
        const retc = await cmt.build();
        assert.strictEqual(retc, 0);
        const outfile = Fixture.resolvePath('output-file.txt');
        const test_string = 'ceacrybuhksrvniruc48o7dvz';
        const varname = 'CMTTestEnvironmentVariable';
        await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
            args: [
                '--write-file', outfile,
                '--env', varname,
            ],
            environment: [{
                name: varname,
                value: test_string,
            }]
        });
        await util.pause(1000);
        await cmt.debugTarget();
        await util.pause(1000);
        const content = (await async.readFile(outfile)).toString();
        assert.strictEqual(content, test_string);
    });
    test(`Get compilation info for a file [${tag}]`, async function () {
        const retc = await cmt.configure();
        assert.strictEqual(retc, 0);
        const info = await cmt.compilationInfoForFile(Fixture.resolvePath('test_project/main.cpp'));
        assert(info);
    });
    teardown(async function () {
        const bindir = await cmt.binaryDir;
        await cmt.dispose();
        if (fs.existsSync(bindir)) {
            rimraf.sync(bindir);
        }
        const output_file = Fixture.resolvePath('output-file.txt');
        if (fs.existsSync(output_file)) {
            fs.unlinkSync(output_file);
        }
        // await cmt.start();
    });
};
// suite('Extension smoke tests [without cmake-server]', function() {
//     smokeTests(this, 'without cmake-server', async() => {
//         await vscode.workspace.getConfiguration('cmake').update('useCMakeServer', false);
//     });
// });
suite.skip('Extension smoke tests [with cmake-server]', function () {
    smokeTests(this, 'with cmake-server', async () => {
        await vscode.workspace.getConfiguration('cmake').update('useCMakeServer', true);
    });
});