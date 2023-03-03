import IDesktopAppEvents from '@ulixee/desktop-interfaces/events/IDesktopAppEvents';
import { IDesktopAppApis } from '@ulixee/desktop-interfaces/apis';
import EventSubscriber from '@ulixee/commons/lib/EventSubscriber';
import UlixeeHostsConfig from '@ulixee/commons/config/hosts';
import { app, screen } from 'electron';
import { ClientOptions } from 'ws';
import * as Http from 'http';
import { httpGet } from '@ulixee/commons/lib/downloadFile';
import { TypedEventEmitter } from '@ulixee/commons/lib/eventUtils';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import WebSocket = require('ws');
import ApiClient from './ApiClient';

app.commandLine.appendSwitch('remote-debugging-port', '8315');

const { version } = require('../package.json');

export default class ApiManager<
  TEventType extends keyof IDesktopAppEvents & string = keyof IDesktopAppEvents,
> extends TypedEventEmitter<{
  'api-event': {
    cloudAddress: string;
    eventType: TEventType;
    data: IDesktopAppEvents[TEventType];
  };
  'new-cloud-address': {
    oldAddress?: string;
    type: 'local' | 'public' | 'private';
    name: string;
    address: string;
  };
}> {
  public apiByCloudAddress = new Map<
    string,
    { name: string; type: 'local' | 'public' | 'private'; resolvable: Resolvable<IApiGroup> }
  >();

  exited = false;
  events = new EventSubscriber();
  localCloudAddress: string;
  debuggerUrl: string;

  constructor() {
    super();
    this.events.on(UlixeeHostsConfig.global, 'change', this.onNewLocalCloudAddress.bind(this));
  }

  public async start(localCloudAddress: string): Promise<void> {
    this.debuggerUrl = await this.getDebuggerUrl();
    localCloudAddress ??= UlixeeHostsConfig.global.getVersionHost(version);
    if (localCloudAddress) {
      this.localCloudAddress = this.formatCloudAddress(localCloudAddress);
      await this.connectToCloud(this.localCloudAddress, 'local');
    }
  }

  public close(): void {
    if (this.exited) return;
    this.exited = true;

    this.events.close('error');
    for (const connection of this.apiByCloudAddress.values()) {
      void this.closeApiGroup(connection.resolvable);
    }
    this.apiByCloudAddress.clear();
  }

  public async connectToCloud(
    address: string,
    type: 'public' | 'private' | 'local',
    name?: string,
    oldAddress?: string,
  ): Promise<void> {
    if (!address) return;
    name ??= type;
    address = this.formatCloudAddress(address);
    if (this.apiByCloudAddress.has(address)) {
      await this.apiByCloudAddress.get(address).resolvable.promise;
      return;
    }
    try {
      this.apiByCloudAddress.set(address, {
        name: name ?? type,
        type,
        resolvable: new Resolvable(),
      });

      const api = new ApiClient<IDesktopAppApis, IDesktopAppEvents>(
        `${address}?type=app`,
        this.onDesktopEvent.bind(this, address),
      );
      await api.connect();
      const onApiClosed = this.events.once(api, 'close', this.onApiClosed.bind(this, address));

      const mainScreen = screen.getPrimaryDisplay();
      const workarea = mainScreen.workArea;
      const { id } = await api.send('App.connect', {
        workarea: {
          left: workarea.x,
          top: workarea.y,
          ...workarea,
          scale: mainScreen.scaleFactor,
        },
      });

      let url: URL;
      try {
        url = new URL(`/desktop-devtools`, api.transport.host);
        url.searchParams.set('id', id);
      } catch (error) {
        console.error('Invalid ChromeAlive Devtools URL', error, { address });
      }
      // pipe connection
      const [wsToCore, wsToDevtoolsProtocol] = await Promise.all([
        this.connectToWebSocket(url.href, { perMessageDeflate: true }),
        this.connectToWebSocket(this.debuggerUrl),
      ]);
      const events = [
        this.events.on(wsToCore, 'message', msg => wsToDevtoolsProtocol.send(msg)),
        this.events.on(wsToCore, 'error', this.onDevtoolsError.bind(this, wsToCore)),
        this.events.once(wsToCore, 'close', this.onApiClosed.bind(this, address)),
        this.events.on(wsToDevtoolsProtocol, 'message', msg => wsToCore.send(msg)),
        this.events.on(
          wsToDevtoolsProtocol,
          'error',
          this.onDevtoolsError.bind(this, wsToDevtoolsProtocol),
        ),
        this.events.once(wsToDevtoolsProtocol, 'close', this.onApiClosed.bind(this, address)),
      ];
      this.events.group(`ws-${address}`, onApiClosed, ...events);
      this.apiByCloudAddress
        .get(address)
        .resolvable.resolve({ id, api, wsToCore, wsToDevtoolsProtocol });
      this.emit('new-cloud-address', {
        address,
        name,
        type,
        oldAddress,
      });
    } catch (error) {
      this.apiByCloudAddress.get(address)?.resolvable.reject(error, true);
      throw error;
    }
  }

  private onDesktopEvent(
    cloudAddress: string,
    eventType: TEventType,
    data: IDesktopAppEvents[TEventType],
  ): void {
    if (this.exited) return;

    if (eventType === 'Session.opened') {
      this.emit('api-event', { cloudAddress, eventType, data });
    }

    if (eventType === 'App.quit') {
      const apis = this.apiByCloudAddress.get(cloudAddress);
      if (apis) {
        void this.closeApiGroup(apis.resolvable);
      }
    }
  }

  private onDevtoolsError(ws: WebSocket, error: Error): void {
    console.warn('ERROR in devtools websocket with Core at %s', ws.url, error);
  }

  private async onNewLocalCloudAddress(): Promise<void> {
    const newAddress = UlixeeHostsConfig.global.getVersionHost(version);
    if (!newAddress) return;
    if (this.localCloudAddress !== newAddress) {
      const oldAddress = this.localCloudAddress;
      this.localCloudAddress = this.formatCloudAddress(newAddress);
      // eslint-disable-next-line no-console
      console.log('Connecting to local cloud', this.localCloudAddress);
      await this.connectToCloud(this.localCloudAddress, 'local', 'local', oldAddress);
    }
  }

  private onApiClosed(address: string): void {
    console.warn('Api Disconnected', address);
    const api = this.apiByCloudAddress.get(address);
    this.events.endGroup(`ws-${address}`);
    if (api) {
      void this.closeApiGroup(api.resolvable);
    }
    this.apiByCloudAddress.delete(address);
  }

  private async closeApiGroup(group: Resolvable<IApiGroup>): Promise<void> {
    const { api, wsToCore, wsToDevtoolsProtocol } = await group;
    if (api.isConnected) await api.disconnect();
    wsToCore?.close();
    return wsToDevtoolsProtocol?.close();
  }

  private async connectToWebSocket(host: string, options?: ClientOptions): Promise<WebSocket> {
    const ws = new WebSocket(host, options);
    await new Promise<void>((resolve, reject) => {
      const closeEvents = [
        this.events.once(ws, 'close', reject),
        this.events.once(ws, 'error', reject),
      ];
      this.events.once(ws, 'open', () => {
        this.events.off(...closeEvents);
        resolve();
      });
    });
    return ws;
  }

  private async getDebuggerUrl(): Promise<string> {
    const res = await new Promise<Http.IncomingMessage>(resolve =>
      httpGet(`http://localhost:8315/json/version`, resolve),
    );
    res.setEncoding('utf8');
    let jsonString = '';
    for await (const chunk of res) jsonString += chunk;
    const debugEndpoints = JSON.parse(jsonString);

    return debugEndpoints.webSocketDebuggerUrl;
  }

  private formatCloudAddress(host: string): string {
    if (!host) return host;
    if (host.endsWith('/')) host = host.slice(0, -1);
    if (!host.endsWith('/desktop')) {
      host += '/desktop';
    }
    if (!host.includes('://')) {
      host = `ws://${host}`;
    }
    return host;
  }
}

interface IApiGroup {
  api: ApiClient<IDesktopAppApis, IDesktopAppEvents>;
  id: string;
  wsToCore: WebSocket;
  wsToDevtoolsProtocol: WebSocket;
}
