import {Disposable, Event, EventEmitter} from 'vscode';

/**
 * Information about current long-running activity, like
 * initializing, building, etc.
 */
export class Activity {
  name: string;
  // TODO: add cancellation, etc.
}

/**
 * The Model for the extension state and available actions.
 */
export class Model implements Disposable {
  /**
   * Notifies when activity changes.
   * The previous activity is passed as a parameter.
   */
  get onDidChangeActivity(): Event<Activity|undefined> { return this._onDidChangeActivity.event; }
  private _onDidChangeActivity = new EventEmitter<Activity|undefined>();

  /**
   * The current long-term activity of the extension ("Initializing", etc).
   */
  get activity(): Activity|undefined { return this._activity; }
  set activity(activity: Activity|undefined) {
    const previousActivity = this._activity;
    this._activity = activity;
    this._onDidChangeActivity.fire(previousActivity);
  }
  private _activity?: Activity;

  dispose(): void { [this._onDidChangeActivity].forEach(d => d.dispose()); }
}