import * as assert from 'assert';
import * as path from 'path';

import * as api from '../src/api';
import * as util from '../src/util';

import { CMakeCache } from '../src/cache';
import { Uri } from 'vscode';
import { CompilationDatabase } from '../src/compdb';
import { parseGNULDDiagnostic, parseGHSDiagnostic, parseGCCDiagnostic } from "../src/diagnostics";
import { Fixture } from "./fixture";

suite("Utility tests", () => {
    test("Read CMake Cache", async function () {
        const cache = await CMakeCache.fromPath(Fixture.resolvePath('TestCMakeCache.txt'));
        const generator = cache.get("CMAKE_GENERATOR") as api.CacheEntry;
        assert.strictEqual(
            generator.type,
            api.EntryType.Internal
        );
        assert.strictEqual(
            generator.key,
            'CMAKE_GENERATOR'
        );
        assert.strictEqual(
            generator.value,
            'Ninja'
        );
        assert.strictEqual(
            generator.as<string>(),
            'Ninja'
        );
        assert.strictEqual(typeof generator.value === 'string', true);

        const build_testing = await cache.get('BUILD_TESTING') as api.CacheEntry;
        assert.strictEqual(
            build_testing.type,
            api.EntryType.Bool
        );
        assert.strictEqual(
            build_testing.as<boolean>(),
            true
        );
    });
    test("Read cache with various newlines", async function () {
        for (const newline of ['\n', '\r\n', '\r']) {
            const str = [
                '# This line is ignored',
                '// This line is docs',
                'SOMETHING:STRING=foo',
                ''
            ].join(newline);
            const entries = CMakeCache.parseCache(str);
            const message = `Using newline ${JSON.stringify(newline)}`
            assert.strictEqual(entries.size, 1, message);
            assert.strictEqual(entries.has('SOMETHING'), true);
            const entry = entries.get('SOMETHING')!;
            assert.strictEqual(entry.value, 'foo');
            assert.strictEqual(entry.type, api.EntryType.String);
            assert.strictEqual(entry.helpString, 'This line is docs');
        }
    });
    test('Falsey values', () => {
        for (const thing of [
            '0',
            '',
            'NO',
            'FALSE',
            'OFF',
            'NOTFOUND',
            'IGNORE',
            'N',
            'SOMETHING-NOTFOUND',
            null,
            false,
        ]) {
            assert.strictEqual(util.isTruthy(thing), false, 'Testing truthiness of ' + thing);
        }
    });
    test('Truthy values', () => {
        for (const thing of [
            '1',
            'ON',
            'YES',
            'Y',
            '112',
            12,
            'SOMETHING'
        ]) {
            assert.strictEqual(util.isTruthy(thing), true, 'Testing truthiness of ' + thing);
        }
    });
    test('Parsing Apple Clang Diagnostics', () => {
        const line = '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h:85:15: warning: comparison of unsigned expression >= 0 is always true [-Wtautological-compare]';
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 84);
            assert.strictEqual(diag.message, 'comparison of unsigned expression >= 0 is always true [-Wtautological-compare]');
            assert.strictEqual(diag.column, 14);
            assert.strictEqual(diag.file, '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h');
            assert.strictEqual(diag.severity, 'warning');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parse more GCC diagnostics', () => {
        const line = `/Users/Tobias/Code/QUIT/Source/qidespot1.cpp:303:49: error: expected ';' after expression`;
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.file, '/Users/Tobias/Code/QUIT/Source/qidespot1.cpp');
            assert.strictEqual(diag.line, 302);
            assert.strictEqual(diag.column, 48);
            assert.strictEqual(diag.message, `expected ';' after expression`);
            assert.strictEqual(diag.severity, 'error');
        }
    });
    test('Parsing fatal error diagnostics', () => {
        const line = '/some/path/here:4:26: fatal error: some_header.h: No such file or directory';
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 3);
            assert.strictEqual(diag.message, 'some_header.h: No such file or directory');
            assert.strictEqual(diag.column, 25);
            assert.strictEqual(diag.file, '/some/path/here');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing fatal error diagnostics in french', () => {
        const line = '/home/romain/TL/test/base.c:2:21: erreur fatale : bonjour.h : Aucun fichier ou dossier de ce type';
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 1);
            assert.strictEqual(diag.message, 'bonjour.h : Aucun fichier ou dossier de ce type');
            assert.strictEqual(diag.column, 20);
            assert.strictEqual(diag.file, '/home/romain/TL/test/base.c');
            assert.strictEqual(diag.severity, 'erreur');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing warning diagnostics', () => {
        const line = "/some/path/here:4:26: warning: unused parameter 'data'";
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 3);
            assert.strictEqual(diag.message, "unused parameter 'data'");
            assert.strictEqual(diag.column, 25);
            assert.strictEqual(diag.file, '/some/path/here');
            assert.strictEqual(diag.severity, 'warning');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing warning diagnostics 2', () => {
        const line = `/test/main.cpp:21:14: warning: unused parameter ‘v’ [-Wunused-parameter]`;
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 20);
            assert.strictEqual(diag.column, 13);
            assert.strictEqual(diag.file, '/test/main.cpp');
            assert.strictEqual(diag.message, `unused parameter ‘v’ [-Wunused-parameter]`);
            assert.strictEqual(diag.severity, 'warning');
        }
    })
    test('Parsing warning diagnostics in french', () => {
        const line = '/home/romain/TL/test/base.c:155:2: attention : déclaration implicite de la fonction ‘create’';
        const diag = parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 154);
            assert.strictEqual(diag.message, 'déclaration implicite de la fonction ‘create’');
            assert.strictEqual(diag.column, 1);
            assert.strictEqual(diag.file, '/home/romain/TL/test/base.c');
            assert.strictEqual(diag.severity, 'attention');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing linker error', () => {
        const line = "/some/path/here:101: undefined reference to `some_function'";
        const diag = parseGNULDDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 100);
            assert.strictEqual(diag.message, "undefined reference to `some_function'");
            assert.strictEqual(diag.file, '/some/path/here');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing linker error in french', () => {
        const line = "/home/romain/TL/test/test_fa_tp4.c:9 : référence indéfinie vers « create_automaton_product56 »";
        const diag = parseGNULDDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 8);
            assert.strictEqual(diag.message, "référence indéfinie vers « create_automaton_product56 »");
            assert.strictEqual(diag.file, '/home/romain/TL/test/test_fa_tp4.c');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing GHS Diagnostics', () => {
        const line = '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): warning #68-D: integer conversion resulted in a change of sign';
        const diag = parseGHSDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 630);
            assert.strictEqual(diag.message, '#68-D: integer conversion resulted in a change of sign');
            assert.strictEqual(diag.column, 2);
            assert.strictEqual(diag.file, 'C:\\path\\source\\debug\\debug.c');
            assert.strictEqual(diag.severity, 'warning');
            assert.strictEqual(path.win32.normalize(diag.file), diag.file);
            assert(path.win32.isAbsolute(diag.file));
        }
    });
    test('Parsing GHS Diagnostics At end of source', () => {
        const line = '"C:\\path\\source\\debug\\debug.c", At end of source: remark #96-D: a translation unit must contain at least one declaration';
        const diag = parseGHSDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 0);
            assert.strictEqual(diag.message, '#96-D: a translation unit must contain at least one declaration');
            assert.strictEqual(diag.column, 0);
            assert.strictEqual(diag.file, 'C:\\path\\source\\debug\\debug.c');
            assert.strictEqual(diag.severity, 'remark');
            assert.strictEqual(path.win32.normalize(diag.file), diag.file);
            assert(path.win32.isAbsolute(diag.file));
        }
    });
    test('Parsing GHS Diagnostics fatal error', () => {
        const line = '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): fatal error #68: some fatal error';
        const diag = parseGHSDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 630);
            assert.strictEqual(diag.message, '#68: some fatal error');
            assert.strictEqual(diag.column, 2);
            assert.strictEqual(diag.file, 'C:\\path\\source\\debug\\debug.c');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.win32.normalize(diag.file), diag.file);
            assert(path.win32.isAbsolute(diag.file));
        }
    });
    test('No parsing Make errors', () => {
        const lines = [
            `make[2]: *** [CMakeFiles/myApp.dir/build.make:87: CMakeFiles/myApp.dir/app.cpp.o] Error 1`,
            `make[1]: *** [CMakeFiles/Makefile2:68: CMakeFiles/myApp.dir/all] Error 2`,
            `make: *** [Makefile:84 all] Error 2`
        ];
        const diags = lines.map(l => parseGNULDDiagnostic(l));
        assert.strictEqual(diags[0], null);
        assert.strictEqual(diags[1], null);
        assert.strictEqual(diags[2], null);
    });
    test('Parsing compilation databases', () => {
        const dbpath = Fixture.resolvePath('test_compdb.json');
        return CompilationDatabase.fromFilePath(dbpath).then(db => {
            assert(db);
            if (db) {
                const source_path = "/home/clang-languageservice/main.cpp";
                const info = db.getCompilationInfoForUri(Uri.file(source_path));
                assert(info);
                if (info) {
                    assert.strictEqual(source_path, info.file);
                    assert.strictEqual('/home/clang-languageservice/build', info.compile!.directory);
                    assert.strictEqual(info.compile!.command, "/usr/local/bin/clang++   -DBOOST_THREAD_VERSION=3 -isystem ../extern/nlohmann-json/src  -g   -std=gnu++11 -o CMakeFiles/clang-languageservice.dir/main.cpp.o -c /home/clang-languageservice/main.cpp")
                }
            }
        })
    });
    test('Parsing gnu-style compile info', () => {
        const raw: api.RawCompilationInfo = {
            command: 'clang++ -I/foo/bar -isystem /system/path -fsome-compile-flag -DMACRO=DEFINITION -I ../relative/path "-I/path\\"with\\" embedded quotes/foo"',
            directory: '/some/dir',
            file: 'meow.cpp'
        };
        const info = util.parseRawCompilationInfo(raw);
        assert.strictEqual(raw.command, info.compile!.command);
        assert.strictEqual(raw.directory, info.compile!.directory);
        assert.strictEqual(raw.file, info.file);
        let idx = info.includeDirectories.findIndex(i => i.path === '/system/path');
        assert(idx >= 0);
        let inc = info.includeDirectories[idx];
        assert(inc.isSystem);
        assert.strictEqual(inc.path, '/system/path');
        idx = info.includeDirectories.findIndex(i => i.path === '/some/relative/path');
        assert(idx >= 0);
        inc = info.includeDirectories[idx];
        assert(!inc.isSystem);
        inc = info.includeDirectories[3];
        assert.strictEqual(inc.path, '/path"with" embedded quotes/foo');
        assert.strictEqual(info.compileDefinitions['MACRO'], 'DEFINITION');
        assert.strictEqual(info.compileFlags[0], '-fsome-compile-flag');
        assert.strictEqual(info.compiler, 'clang++');
    });
    test('Parsing MSVC-style compile info', () => {
        const raw: api.RawCompilationInfo = {
            command: 'cl.exe -I/foo/bar /I/system/path /Z+:some-compile-flag /DMACRO=DEFINITION -I ../relative/path "/I/path\\"with\\" embedded quotes/foo"',
            directory: '/some/dir',
            file: 'meow.cpp'
        };
        const info = util.parseRawCompilationInfo(raw);
        assert.strictEqual(raw.command, info.compile!.command);
        assert.strictEqual(raw.directory, info.compile!.directory);
        assert.strictEqual(raw.file, info.file);
        let idx = info.includeDirectories.findIndex(i => i.path === '/system/path');
        assert(idx >= 0);
        let inc = info.includeDirectories[idx];
        assert(!inc.isSystem);
        assert.strictEqual(inc.path, '/system/path');
        idx = info.includeDirectories.findIndex(i => i.path === '/some/relative/path');
        assert(idx >= 0);
        inc = info.includeDirectories[idx];
        assert(!inc.isSystem);
        inc = info.includeDirectories[3];
        assert.strictEqual(inc.path, '/path"with" embedded quotes/foo');
        assert.strictEqual(info.compileDefinitions['MACRO'], 'DEFINITION');
        assert.strictEqual(info.compileFlags[0], '/Z+:some-compile-flag');
        assert.strictEqual(info.compiler, 'cl.exe');
    });
    test('Version compare', async function () {
        assert(!util.versionGreater(util.parseVersion('3.0.2'), '3.7.1'));
        assert(util.versionGreater(util.parseVersion('1.0.1'), '1.0.0'));
        assert(util.versionGreater(util.parseVersion('1.1.2'), '1.0.3'));
        assert(util.versionGreater(util.parseVersion('1.2.3'), '0.4.5'));
    });
    // test('Can access the extension API', async function () {
    //     this.timeout(40000);
    //     const api = await getExtension();
    //     assert(await api.binaryDir);
    // });
});