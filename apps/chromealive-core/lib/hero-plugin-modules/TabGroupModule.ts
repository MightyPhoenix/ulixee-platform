import { EventEmitter } from 'events';
import { IPuppetPage } from '@ulixee/hero-interfaces/IPuppetPage';
import { ISessionSummary } from '@ulixee/hero-interfaces/ICorePlugin';
import BridgeToExtension from '../bridges/BridgeToExtension';
import {
  createResponseId,
  IMessageObject,
  MessageLocation,
  ResponseCode,
} from '../BridgeHelpers';

export default class TabGroupModule {
  public static bySessionId = new Map<string, TabGroupModule>();

  private runOnTabGroupOpened: () => void;

  private bridgeToExtension: BridgeToExtension;
  private identityByPageId = new Map<string, { tabId: number; windowId: number }>();
  private sessionId: string;

  constructor(bridgeToExtension, browserEmitter: EventEmitter) {
    this.bridgeToExtension = bridgeToExtension;
    browserEmitter.on('message', (message, { pageId }) => {
      if (message.event === 'OnTabIdentify') {
        this.onTabIdentified(pageId, message);
      } else if (message.event === 'OnTabGroupOpened') {
        this.onTabGroupOpened();
      }
    });
  }

  public onNewPuppetPage(page: IPuppetPage, sessionSummary: ISessionSummary): Promise<any> {
    if (!sessionSummary.options.showBrowser) return;

    this.sessionId = sessionSummary.id;
    TabGroupModule.bySessionId.set(this.sessionId, this);
    page.on('close', this.pageClosed.bind(this, page));
    page.browserContext.on('close', this.close.bind(this));
  }

  public close() {
    TabGroupModule.bySessionId.delete(this.sessionId);
  }

  public async groupTabs(
    puppetPages: IPuppetPage[],
    title: string,
    color: string,
    collapsed: boolean,
    onUncollapsed?: () => void,
  ): Promise<number> {
    const tabIds: number[] = [];
    let windowId: number;
    for (const page of puppetPages) {
      const id = this.identityByPageId.get(page.id);
      if (id) {
        windowId = id.windowId;
        tabIds.push(id.tabId);
      }
    }
    const args = {
      tabIds,
      windowId,
      title,
      color,
      collapsed: true,
    };
    const groupId = await this.sendToExtensionBackground<number>('groupTabs', args, true);
    // don't register the tab group opened command until after it opens
    await new Promise(setImmediate);
    if (collapsed && onUncollapsed) this.runOnTabGroupOpened = onUncollapsed;
    return groupId;
  }

  public async ungroupTabs(puppetPages: IPuppetPage[]): Promise<void> {
    const tabIds: number[] = [];
    for (const page of puppetPages) {
      const id = this.identityByPageId.get(page.id);
      if (id) tabIds.push(id.tabId);
    }
    this.runOnTabGroupOpened = null;
    const args = { tabIds };
    await this.sendToExtensionBackground<void>('ungroupTabs', args, false);
  }

  private onTabGroupOpened(): void {
    if (this.runOnTabGroupOpened) this.runOnTabGroupOpened();
  }

  private onTabIdentified(puppetPageId: string, payload: string): void {
    const { windowId, tabId } = JSON.parse(payload);
    this.identityByPageId.set(puppetPageId, { windowId, tabId });
  }

  private async sendToExtensionBackground<T>(
    action: string,
    args: object = {},
    waitForResponse = false,
  ): Promise<T> {
    const responseCode = waitForResponse ? ResponseCode.Y : ResponseCode.N;
    const responseId = responseCode === ResponseCode.Y ? createResponseId() : undefined;
    const message: IMessageObject = {
      destLocation: MessageLocation.BackgroundScript,
      origLocation: MessageLocation.Core,
      payload: { action, ...args },
      responseCode,
      responseId,
    };
    return (await this.bridgeToExtension.send(message, null)) as T;
  }

  private pageClosed(page: IPuppetPage) {
    this.identityByPageId.delete(page.id);
  }
}