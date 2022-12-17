import { SqlParser } from '@ulixee/sql-engine';
import * as util from 'util';
import { parseEnvBool } from '@ulixee/commons/lib/envUtils';
import FunctionInternal from './FunctionInternal';
import Autorun from './utils/Autorun';
import readCommandLineArgs from './utils/readCommandLineArgs';
import { IFunctionPluginConstructor } from '../interfaces/IFunctionPluginStatics';
import IFunctionContext from '../interfaces/IFunctionContext';
import IFunctionSchema from '../interfaces/IFunctionSchema';
import IFunctionExecOptions from '../interfaces/IFunctionExecOptions';
import IFunctionComponents from '../interfaces/IFunctionComponents';
import FunctionPlugins from './FunctionPlugins';
import DataboxInternal from './DataboxInternal';
import Databox from './Databox';

export default class Function<
  ISchema extends IFunctionSchema = IFunctionSchema<any, any>,
  IPlugin1 extends IFunctionPluginConstructor<ISchema> = IFunctionPluginConstructor<ISchema>,
  IPlugin2 extends IFunctionPluginConstructor<ISchema> = IFunctionPluginConstructor<ISchema>,
  IPlugin3 extends IFunctionPluginConstructor<ISchema> = IFunctionPluginConstructor<ISchema>,
  IRunContext extends IFunctionContext<ISchema> = IFunctionContext<ISchema> &
    IPlugin1['runContextAddons'] &
    IPlugin2['runContextAddons'] &
    IPlugin3['runContextAddons'],
  IBeforeRunContext extends IFunctionContext<ISchema> = IFunctionContext<ISchema> &
    IPlugin1['beforeRunContextAddons'] &
    IPlugin2['beforeRunContextAddons'] &
    IPlugin3['beforeRunContextAddons'],
  IAfterRunContext extends IFunctionContext<ISchema> = IFunctionContext<ISchema> &
    IPlugin1['afterRunContextAddons'] &
    IPlugin2['afterRunContextAddons'] &
    IPlugin3['afterRunContextAddons'],
> {
  #isRunning = false;
  #databoxInternal: DataboxInternal<any, any>;

  public disableAutorun: boolean;
  public successCount = 0;
  public errorCount = 0;
  public pricePerQuery = 0;
  public minimumPrice?: number;
  public addOnPricing?: {
    perKb?: number;
  };

  public readonly plugins: FunctionPlugins<
    ISchema,
    IRunContext,
    IBeforeRunContext,
    IAfterRunContext
  >;

  public get schema(): ISchema {
    return this.components.schema;
  }

  public get name(): string {
    return this.components.name;
  }

  public get description(): string | undefined {
    return this.components.description;
  }

  public get databox(): Databox<any, any> {
    return this.databoxInternal.databox;
  }

  public get databoxInternal(): DataboxInternal<any, any> {
    if (!this.#databoxInternal) {
      this.#databoxInternal = new DataboxInternal({});
      this.#databoxInternal.databox = new Databox({}, this.databoxInternal);
      this.databoxInternal.attachFunction(this, null, false);
      this.#databoxInternal.onCreateInMemoryDatabase(this.createInMemoryFunction.bind(this));
    }
    return this.#databoxInternal;
  }

  protected readonly components: IFunctionComponents<
    ISchema,
    IRunContext,
    IBeforeRunContext,
    IAfterRunContext
  > &
    IPlugin1['componentAddons'] &
    IPlugin2['componentAddons'] &
    IPlugin3['componentAddons'];

  constructor(
    components: (
      | IFunctionComponents<ISchema, IRunContext, IBeforeRunContext, IAfterRunContext>
      | IFunctionComponents<ISchema, IRunContext, IBeforeRunContext, IAfterRunContext>['run']
    ) &
      IPlugin1['componentAddons'] &
      IPlugin2['componentAddons'] &
      IPlugin3['componentAddons'],
    ...plugins: [plugin1?: IPlugin1, plugin2?: IPlugin2, plugin3?: IPlugin3]
  ) {
    this.components =
      typeof components === 'function'
        ? {
            run: components,
          }
        : { ...components };

    this.components.name ??= 'default';
    this.plugins = new FunctionPlugins(this.components);
    this.plugins.add(...plugins);
    this.pricePerQuery = this.components.pricePerQuery ?? 0;
    this.addOnPricing = this.components.addOnPricing;
    this.minimumPrice = this.components.minimumPrice;

    this.disableAutorun = Boolean(
      JSON.parse(process.env.ULX_DATABOX_DISABLE_AUTORUN?.toLowerCase() ?? 'false'),
    );
  }

  public async exec(
    options: IFunctionExecOptions<ISchema> &
      IPlugin1['execArgAddons'] &
      IPlugin2['execArgAddons'] &
      IPlugin3['execArgAddons'],
  ): Promise<IFunctionContext<ISchema>['outputs']> {
    if (this.#isRunning) {
      throw new Error('Databox already running');
    }
    this.#isRunning = true;
    const functionInternal = new FunctionInternal(options, this.components);

    try {
      functionInternal.validateInput();

      const lifecycle = await this.plugins.initialize(functionInternal, this.databox);

      let execError: Error;
      try {
        if (this.components.beforeRun && lifecycle.beforeRun.isEnabled) {
          await this.components.beforeRun(lifecycle.beforeRun.context);
        }
        if (this.components.run && lifecycle.run.isEnabled) {
          await this.components.run(lifecycle.run.context);
        }
        if (this.components.afterRun && lifecycle.afterRun.isEnabled) {
          await this.components.afterRun(lifecycle.afterRun.context);
        }
      } catch (error) {
        execError = error;
      }

      const results = functionInternal.outputs.map(x => x.toJSON?.() ?? x);
      await this.plugins.setResolution(results, execError);

      if (execError) throw execError;

      let counter = 1;
      for (const result of results) {
        let humanCounter = '1st';
        if (counter === 2) humanCounter = '2nd';
        if (counter === 3) humanCounter = '3rd';
        if (counter >= 4) humanCounter = `${counter}th`;
        functionInternal.validateOutput(result, `'s ${humanCounter} `);
        counter += 1;
      }

      this.successCount++;

      if (options.isFromCommandLine && process.env.NODE_ENV !== 'test') {
        const disableColors = parseEnvBool(process.env.NODE_DISABLE_COLORS) ?? false;
        // eslint-disable-next-line no-console
        console.log(util.inspect(results, false, null, !disableColors));
      }
      return results;
    } catch (error) {
      error.stack = error.stack.split('at async Function.exec').shift().trim();
      console.error(`ERROR running databox: `, error);
      this.errorCount++;
      throw error;
    } finally {
      await functionInternal.close();
      this.#isRunning = false;
    }
  }

  public async query(sql: string, boundValues: any[] = []): Promise<any> {
    await this.databoxInternal.ensureDatabaseExists();
    const name = this.components.name;
    const databoxInstanceId = this.databoxInternal.instanceId;
    const databoxVersionHash = this.databoxInternal.manifest?.versionHash;

    const sqlParser = new SqlParser(sql, { function: name });
    const schemas = { [name]: this.schema.input };
    const inputsByFunction = sqlParser.extractFunctionInputs<ISchema['input']>(
      schemas,
      boundValues,
    );
    const input = inputsByFunction[name];
    const outputs = await this.exec({ input });

    const args = {
      name,
      sql,
      boundValues,
      input,
      outputs,
      databoxInstanceId,
      databoxVersionHash,
    };
    return await this.databoxInternal.sendRequest({
      command: 'Databox.queryInternalFunction',
      args: [args],
    });
  }

  public attachToDatabox(databoxInternal: DataboxInternal<any, any>, functionName: string): void {
    this.components.name = functionName;
    if (this.#databoxInternal && this.#databoxInternal === databoxInternal) return;
    if (this.#databoxInternal) {
      throw new Error(`${functionName} Function is already attached to a Databox`);
    }

    this.#databoxInternal = databoxInternal;
    if (!databoxInternal.manifest?.versionHash) {
      this.#databoxInternal.onCreateInMemoryDatabase(this.createInMemoryFunction.bind(this));
    }
  }

  private async createInMemoryFunction(): Promise<void> {
    const databoxInstanceId = this.databoxInternal.instanceId;
    const name = this.components.name;
    const args = {
      name,
      databoxInstanceId,
      schema: this.components.schema,
    };
    await this.databoxInternal.sendRequest({
      command: 'Databox.createInMemoryFunction',
      args: [args],
    });
  }

  public static commandLineExec<TOutput>(
    databoxFunction: Function<any, any, any>,
  ): Promise<TOutput | Error> {
    const options = readCommandLineArgs();
    options.isFromCommandLine = true;
    return databoxFunction.exec(options).catch(err => err);
  }
}

Autorun.setupAutorunBeforeExitHook(Function, module.parent, require.main);
