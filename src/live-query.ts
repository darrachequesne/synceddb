import { CHANGE_EVENT_NAME } from './constants.js';
import { UpdateEvent } from './wrap-idb-value.js';

function noop() {}

export class LiveQuery<T> {
  private isRunning: boolean = false;
  private shouldRerun: boolean = false;

  constructor(
      private readonly dependencies: string[],
      private readonly provider: () => Promise<T>,
  ) {
    this.handleUpdateEvent = this.handleUpdateEvent.bind(this);
    addEventListener(CHANGE_EVENT_NAME, this.handleUpdateEvent);
  }

  private handleUpdateEvent(evt: Event) {
    if (!(evt instanceof UpdateEvent)) {
      return;
    }
    const isImpacted = this.dependencies.some((dependency) => {
      return evt.impactedStores.includes(dependency);
    });
    if (!isImpacted) {
      return;
    }
    if (this.isRunning) {
      this.shouldRerun = true;
    } else {
      this.run();
    }
  }

  public run() {
    this.isRunning = true;
    this.shouldRerun = false;

    return this.provider()
      .catch(noop)
      .finally(() => {
        this.isRunning = false;
        if (this.shouldRerun) {
          this.run();
        }
      });
  }

  public close() {
    removeEventListener(CHANGE_EVENT_NAME, this.handleUpdateEvent);
  }
}
