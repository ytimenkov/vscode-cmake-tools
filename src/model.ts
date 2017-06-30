import { Disposable, Event, EventEmitter } from "vscode";

/**
 * The Model for the extension state and available actions.
 */
export class Model implements Disposable {
    /**
     * Notifies about changes in the model.
     */
    get onDidChange(): Event<void> { return this._onDidChange.event; }
    private _onDidChange = new EventEmitter<void>();

    /**
     * The current state of the extension ("Ready", "Initializing", etc).
     */
    get state(): string | undefined {
        return this._state;
    }
    set state(name: string | undefined) {
        this._state = name;
        this._onDidChange.fire();
    }
    private _state?: string;

    /**
     * Notification about binary dir change.
     * The old binary directory is passed to the event handler.
     */
    get onDidBuildDirectoryChange(): Event<string> { return this._onDidBuildDirectoryChange.event }
    private _onDidBuildDirectoryChange = new EventEmitter<string>();

    /**
     * Currently active build directory.
     */
    get buildDirectory(): string | undefined {
        return this._buildDirectory;
    }
    set buildDirectory(path: string | undefined) {
        const previousBuildDirectory = this._buildDirectory;
        this._buildDirectory = path;
        this._onDidBuildDirectoryChange.fire(previousBuildDirectory);
    }
    private _buildDirectory?: string;

    private disposables: Disposable[] = [
        this._onDidChange
    ];
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}