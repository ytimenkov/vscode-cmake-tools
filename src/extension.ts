'use strict';

import * as vscode from 'vscode';
import * as api from './api';
import { CMakeToolsWrapper } from './wrapper';
import { log } from './logging';
import { outputChannels } from "./util";

export async function activate(context: vscode.ExtensionContext): Promise<CMakeToolsWrapper> {
    log.initialize(context);

    const cmake = new CMakeToolsWrapper(context);
    context.subscriptions.push(cmake);

    // Wrap API command in try/catch to avoid strange errors when VS code executes the command.
    // Original API should throw errors to integrate.
    function register(name, fn) {
        return vscode.commands.registerCommand(name, async (...args) => {
            try {
                await fn.bind(cmake)(...args);
            } catch (error) {
                vscode.window.showErrorMessage(`CMake Tools Error: ${error} [See output window for more details]`);
            }
        });
    }

    for (const key of [
        'configure',
        'build',
        'install',
        'jumpToCacheFile',
        'clean',
        'cleanConfigure',
        'cleanRebuild',
        'buildWithTarget',
        'setDefaultTarget',
        'setBuildType',
        'ctest',
        'stop',
        'quickStart',
        'launchTargetProgramPath',
        'debugTarget',
        'launchTarget',
        'selectLaunchTarget',
        'selectEnvironments',
        'toggleCoverageDecorations',
    ]) {
        context.subscriptions.push(register('cmake.' + key, cmake[key]));
    }

    return cmake;
}

// this method is called when your extension is deactivated
export function deactivate() {
    outputChannels.dispose();
}
