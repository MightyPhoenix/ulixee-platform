import { IAsyncFunc } from '@ulixee/net/interfaces/IApiHandlers';
import IConnectionToClient from '@ulixee/net/interfaces/IConnectionToClient';
import ConnectionToClient from '@ulixee/net/lib/ConnectionToClient';
import { DatastoreRegistryApiSchemas } from '@ulixee/platform-specification/services/DatastoreRegistryApis';
import { INodeRegistryApis } from '@ulixee/platform-specification/services/NodeRegistryApis';
import { IServicesSetupApis } from '@ulixee/platform-specification/services/SetupApis';
import { StatsTrackerApiSchemas } from '@ulixee/platform-specification/services/StatsTrackerApis';
import { IZodApiTypes } from '@ulixee/specification/utils/IZodApi';
import ValidationError from '@ulixee/specification/utils/ValidationError';
import ICloudApiContext from '../interfaces/ICloudApiContext';

export type TServicesApis = IServicesSetupApis & INodeRegistryApis;

export type TConnectionToServicesClient = IConnectionToClient<TServicesApis, {}>;

export default class HostedServicesEndpoints {
  public connections = new Set<TConnectionToServicesClient>();

  private readonly handlersByCommand: TServicesApis;

  constructor() {
    this.handlersByCommand = {
      'Services.getSetup': async (_, ctx: ICloudApiContext) => {
        const { datastoreRegistryHost, storageEngineHost, statsTrackerHost } =
          ctx.datastoreConfiguration;
        const { nodeRegistryHost } = ctx.cloudConfiguration;

        return Promise.resolve({
          storageEngineHost,
          datastoreRegistryHost,
          nodeRegistryHost,
          statsTrackerHost,
        });
      },
      'NodeRegistry.getNodes': async ({ count }, ctx: ICloudApiContext) => {
        const nodes = await ctx.nodeRegistry.getNodes(count);
        return { nodes };
      },
      'NodeRegistry.register': async (registration, ctx: ICloudApiContext) => {
        return await ctx.nodeTracker.track({
          ...registration,
          lastSeenDate: new Date(),
          isClusterNode: true,
        });
      },
      'NodeRegistry.health': async (health, ctx: ICloudApiContext) => {
        await ctx.nodeTracker.checkin(health);
        return { success: true };
      },
    };

    for (const [api, handler] of Object.entries(this.handlersByCommand)) {
      const validationSchema = DatastoreRegistryApiSchemas[api] ?? StatsTrackerApiSchemas[api];
      this.handlersByCommand[api] = validateThenRun.bind(api, handler.bind(this), validationSchema);
    }
  }

  public attachToConnection(
    connection: ConnectionToClient<any, any>,
    context: ICloudApiContext,
  ): TConnectionToServicesClient {
    Object.assign(connection.apiHandlers, this.handlersByCommand);
    Object.assign(connection.handlerMetadata, context);
    this.connections.add(connection);
    return connection;
  }
}

function validateThenRun(
  api: string,
  handler: IAsyncFunc,
  validationSchema: IZodApiTypes | undefined,
  args: any,
  context: ICloudApiContext,
): Promise<any> {
  if (!validationSchema) return handler(args);
  // NOTE: mutates `errors`
  const result = validationSchema.args.safeParse(args);
  if (result.success === true) return handler(result.data, context);

  throw ValidationError.fromZodValidation(
    `The parameters for this command (${api}) are invalid.`,
    result.error,
  );
}
