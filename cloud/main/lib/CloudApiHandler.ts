import ValidatingApiHandler from '@ulixee/specification/utils/ValidatingApiHandler';
import ICloudApis, { CloudApiSchemas } from '@ulixee/platform-specification/cloud/CloudApis';
import ICloudApiContext from '../interfaces/ICloudApiContext';

export default class CloudApiHandler<
  Command extends keyof ICloudApis & string,
> extends ValidatingApiHandler<typeof CloudApiSchemas, Command, ICloudApis, ICloudApiContext> {
  constructor(
    command: Command,
    args: {
      handler: (
        this: CloudApiHandler<Command>,
        request: ICloudApis[Command]['args'],
        context?: ICloudApiContext,
      ) => Promise<ICloudApis[Command]['result']>;
    },
  ) {
    super(command, CloudApiSchemas, args);
    this.apiHandler = args.handler.bind(this);
  }
}
