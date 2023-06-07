import { IAsyncFunc } from '@ulixee/net/interfaces/IApiHandlers';
import ITransport from '@ulixee/net/interfaces/ITransport';
import ConnectionToClient from '@ulixee/net/lib/ConnectionToClient';
import {
  DatastoreRegistryApiSchemas,
  IDatastoreRegistryApis,
} from '@ulixee/platform-specification/services/DatastoreRegistryApis';
import {
  IStatsTrackerApis,
  StatsTrackerApiSchemas,
} from '@ulixee/platform-specification/services/StatsTrackerApis';
import { IZodApiTypes } from '@ulixee/specification/utils/IZodApi';
import ValidationError from '@ulixee/specification/utils/ValidationError';
import IDatastoreApiContext from '../interfaces/IDatastoreApiContext';
import { DatastoreNotFoundError } from '../lib/errors';

export type TServicesApis = IDatastoreRegistryApis<IDatastoreApiContext> &
  IStatsTrackerApis<IDatastoreApiContext>;

export type TConnectionToServicesClient = ConnectionToClient<TServicesApis, {}>;

export default class HostedServicesEndpoints {
  public connections = new Set<TConnectionToServicesClient>();

  private readonly handlersByCommand: TServicesApis;

  constructor() {
    this.handlersByCommand = {
      'DatastoreRegistry.downloadDbx': async ({ versionHash }, ctx) => {
        // only get from local if installed
        const result = await ctx.datastoreRegistry.diskStore.getCompressedDbx(versionHash);
        if (!result) {
          throw new DatastoreNotFoundError('Datastore could not be download. Not found locally.', {
            versionHash,
          });
        }
        return result;
      },
      'DatastoreRegistry.get': async ({ versionHash }, ctx) => {
        const datastore = await ctx.datastoreRegistry.getByVersionHash(versionHash, false);
        return { datastore };
      },
      'DatastoreRegistry.getLatestVersion': async ({ versionHash }, ctx) => {
        const latestVersionHash = await ctx.datastoreRegistry.getLatestVersion(versionHash);
        return { latestVersionHash };
      },
      'DatastoreRegistry.getLatestVersionForDomain': async ({ domain }, ctx) => {
        const latestVersionHash = await ctx.datastoreRegistry.getByDomain(domain);
        return { latestVersionHash };
      },
      'DatastoreRegistry.getPreviousInstalledVersion': async ({ versionHash }, ctx) => {
        const datastore = await ctx.datastoreRegistry.getInstalledPreviousVersion(versionHash);
        return { previousVersionHash: datastore?.versionHash };
      },
      'DatastoreRegistry.list': async ({ count, offset }, ctx) => {
        // don't go out to network
        const datastores = await ctx.datastoreRegistry.diskStore.all(count, offset);
        return { datastores };
      },
      'DatastoreRegistry.upload': async (request, ctx) => {
        const { datastoreRegistry, workTracker } = ctx;
        return workTracker.trackUpload(
          datastoreRegistry.saveDbx(request, ctx.connectionToClient?.transport.remoteId),
        );
      },
      'StatsTracker.recordEntityStats': async (args, ctx) => {
        await ctx.statsTracker.recordEntityStats(args);
        return { success: true };
      },
      'StatsTracker.recordQuery': async (args, ctx) => {
        await ctx.statsTracker.recordQuery(args);
        return { success: true };
      },
      'StatsTracker.get': async ({ versionHash }, ctx) => {
        const manifest = await ctx.datastoreRegistry.getByVersionHash(versionHash);
        return await ctx.statsTracker.getForDatastore(manifest);
      },
    };

    for (const [api, handler] of Object.entries(this.handlersByCommand)) {
      const validationSchema = DatastoreRegistryApiSchemas[api] ?? StatsTrackerApiSchemas[api];
      if (!validationSchema) throw new Error(`invalid api ${api}`);
      this.handlersByCommand[api] = validateThenRun.bind(
        this,
        api,
        handler.bind(this),
        validationSchema,
      );
    }
  }

  public addConnection(
    transport: ITransport,
    context: IDatastoreApiContext,
  ): TConnectionToServicesClient {
    const connection = new ConnectionToClient(transport, this.handlersByCommand);
    connection.handlerMetadata = context;
    this.connections.add(connection);
    return connection;
  }
}

export function validateThenRun(
  api: string,
  handler: IAsyncFunc,
  validationSchema: IZodApiTypes | undefined,
  args: any,
  context: IDatastoreApiContext,
): Promise<any> {
  if (!validationSchema) return handler(args, context);
  // NOTE: mutates `errors`
  const result = validationSchema.args.safeParse(args);
  if (result.success === true) return handler(result.data, context);

  throw ValidationError.fromZodValidation(
    `The parameters for this command (${api}) are invalid.`,
    result.error,
  );
}