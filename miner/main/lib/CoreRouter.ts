import * as WebSocket from 'ws';
import { IncomingMessage, ServerResponse } from 'http';
import DatastoreCore from '@ulixee/datastore-core';
import HeroCore from '@ulixee/hero-core';
import IDatastoreCoreConfigureOptions from '@ulixee/datastore-core/interfaces/IDatastoreCoreConfigureOptions';
import WsTransportToClient from '@ulixee/net/lib/WsTransportToClient';
import ShutdownHandler from '@ulixee/commons/lib/ShutdownHandler';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import IConnectionToClient from '@ulixee/net/interfaces/IConnectionToClient';
import ICoreConfigureOptions from '@ulixee/hero-interfaces/ICoreConfigureOptions';
import ChromeAliveUtils from './ChromeAliveUtils';
import Miner, { IHttpHandleFn } from '../index';

export default class CoreRouter {
  public static modulesToRegister = [
    '@ulixee/datastore-plugins-hero-core/register',
    '@ulixee/datastore-plugins-puppeteer-core/register',
  ];

  public heroConfiguration: ICoreConfigureOptions;
  public datastoreConfiguration: Partial<IDatastoreCoreConfigureOptions>;

  public get dataDir(): string {
    return HeroCore.dataDir;
  }

  public get datastoresDir(): string {
    return DatastoreCore.datastoresDir;
  }

  private isClosing: Promise<void>;
  private miner: Miner;
  private readonly connections = new Set<IConnectionToClient<any, any>>();

  private wsConnectionByType = {
    hero: transport => HeroCore.addConnection(transport),
    datastore: transport => DatastoreCore.addConnection(transport) as any,
    chromealive: transport => ChromeAliveUtils.getChromeAlive().addConnection(transport) as any,
  } as const;

  private httpRoutersByType: {
    [key: string]: IHttpHandleFn;
  } = {
    datastore: DatastoreCore.routeHttp.bind(DatastoreCore),
    datastoreRoot: DatastoreCore.routeHttpRoot.bind(DatastoreCore),
    datastoreOptions: DatastoreCore.routeOptions.bind(DatastoreCore),
  };

  constructor(miner: Miner) {
    this.miner = miner;

    miner.addWsRoute('/hero', this.handleSocketRequest.bind(this, 'hero'));
    miner.addWsRoute('/datastore', this.handleSocketRequest.bind(this, 'datastore'));
    miner.addHttpRoute(/\/datastore\/(.+)/, 'GET', this.handleHttpRequest.bind(this, 'datastore'));
    miner.addHttpRoute(/\/(.*)/, 'GET', this.handleHttpRequest.bind(this, 'datastoreRoot'));
    miner.addHttpRoute('/', 'OPTIONS', this.handleHttpRequest.bind(this, 'datastoreOptions'));

    for (const module of CoreRouter.modulesToRegister) {
      safeRegisterModule(module);
    }

    if (ChromeAliveUtils.isInstalled()) {
      miner.addWsRoute('/chromealive', this.handleSocketRequest.bind(this, 'chromealive'));
    }
  }

  public async start(minerAddress: string): Promise<void> {
    HeroCore.onShutdown = () => this.miner.close();
    this.heroConfiguration ??= {};
    this.heroConfiguration.shouldShutdownOnSignals ??= this.miner.shouldShutdownOnSignals;
    await HeroCore.start(this.heroConfiguration);

    if (this.datastoreConfiguration) {
      Object.assign(DatastoreCore.options, this.datastoreConfiguration);
    }

    const [ipAddress, port] = minerAddress.split(':');
    await DatastoreCore.start({ ipAddress, port: Number(port) });

    if (ChromeAliveUtils.isInstalled()) {
      const chromeAliveCore = ChromeAliveUtils.getChromeAlive();
      const wsAddress = Promise.resolve(`ws://${minerAddress}/chromealive`);
      chromeAliveCore.setMinerAddress(wsAddress);
      await chromeAliveCore.register();
    }
  }

  public async close(): Promise<void> {
    if (this.isClosing) return this.isClosing;
    const closeResolvable = new Resolvable<void>();
    this.isClosing = closeResolvable.promise;
    HeroCore.onShutdown = null;
    ShutdownHandler.unregister(this.close);
    try {
      for (const connection of this.connections) {
        await connection.disconnect();
      }
      if (ChromeAliveUtils.isInstalled()) {
        await ChromeAliveUtils.getChromeAlive().shutdown();
      }
      await DatastoreCore.close();
      await HeroCore.shutdown();
      await ShutdownHandler.run();
      closeResolvable.resolve();
    } catch (error) {
      closeResolvable.reject(error);
    }
    return closeResolvable.promise;
  }

  private handleSocketRequest(
    connectionType: keyof CoreRouter['wsConnectionByType'],
    ws: WebSocket,
    req: IncomingMessage,
  ): void {
    const transport = new WsTransportToClient(ws, req);
    const connection = this.wsConnectionByType[connectionType](transport);
    if (!connection) throw new Error(`Unknown connection protocol attempted "${connectionType}"`);
    this.connections.add(connection);
    connection.once('disconnected', () => this.connections.delete(connection));
  }

  private async handleHttpRequest(
    connectionType: keyof CoreRouter['httpRoutersByType'],
    req: IncomingMessage,
    res: ServerResponse,
    params: string[],
  ): Promise<void | boolean> {
    const result = await this.httpRoutersByType[connectionType](req, res, params);
    return result;
  }
}

function safeRegisterModule(path: string): void {
  try {
    // eslint-disable-next-line import/no-dynamic-require
    require(path);
  } catch (err) {
    /* no-op */
  }
}
