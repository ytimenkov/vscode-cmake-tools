import * as path from 'path';
import * as fs from 'fs';

import * as assert from 'assert';

import * as vscode from 'vscode';

import * as api from '../src/api';
import * as wrapper from '../src/wrapper';
import * as util from '../src/util';
import * as async from '../src/async';

import * as rimraf from 'rimraf';

const here = __dirname;

function testFilePath(filename: string): string {
    return path.normalize(path.join(here, '../..', 'test', filename));
}

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
    test(`Can configure [${tag}]`, async function () {
        const retc = await cmt.configure();
        assert.strictEqual(retc, 0);
        assert((await cmt.targets).findIndex(t => t.name === 'MyExecutable') >= 0);
    });
    test(`Configure respects environment overrides [${tag}]`, async function () {
        const homedir_varname = process.platform === 'win32' ? 'PROFILE' : 'HOME';
        const suffix = '-TEST-APPENDED';
        const homedir_var = process.env[homedir_varname] + suffix;
        await vscode.workspace.getConfiguration('cmake').update('configureEnvironment', {
            [homedir_varname]: homedir_var
        });
        const retc = await cmt.configure();
        // Check that the cache got our modified env variable
        const cache_content = await async.readFile(await cmt.cachePath);
        const re = new RegExp("\nENV_HOME:STRING=(.*?)\n");
        const seen = re.exec(cache_content.toString())![1];
        assert.strictEqual(seen, homedir_var);
        await vscode.workspace.getConfiguration('cmake').update('configureEnvironment', undefined);
    });
    test(`Can build named target [${tag}]`, async function () {
        const retc = await cmt.build('MyExecutable');
        assert.strictEqual(retc, 0);
    });
    test(`Non-existent target fails [${tag}]`, async function () {
        const retc = await cmt.build('ThisIsNotAnExistingTarget');
        assert.notStrictEqual(retc, 0);
    });
    test(`Can execute CTest tests [${tag}]`, async function () {
        const retc = await cmt.ctest();
        assert.strictEqual(retc, 0);
    });
    test(`Finds executable targets [${tag}]`, async function () {
        const retc = await cmt.configure();
        assert.strictEqual(retc, 0, 'Configure failed');
        const targets = await cmt.executableTargets;
        assert.strictEqual(targets.length, 1, 'Executable targets are missing');
        assert.strictEqual(targets[0].name, 'MyExecutable');
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
        const outfile = testFilePath('output-file.txt');
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
        const outfile = testFilePath('output-file.txt');
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
        const outfile = testFilePath('output-file.txt');
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
        const info = await cmt.compilationInfoForFile(testFilePath('test_project/main.cpp'));
        assert(info);
    });
    teardown(async function () {
        const bindir = await cmt.binaryDir;
        await cmt.shutdown();
        if (fs.existsSync(bindir)) {
            rimraf.sync(bindir);
        }
        const output_file = testFilePath('output-file.txt');
        if (fs.existsSync(output_file)) {
            fs.unlinkSync(output_file);
        }
        await cmt.start();
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