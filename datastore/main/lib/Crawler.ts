import { date, ISchemaAny, number, string } from '@ulixee/schema';
import StringSchema from '@ulixee/schema/lib/StringSchema';
import DateSchema from '@ulixee/schema/lib/DateSchema';
import TypeSerializer from '@ulixee/commons/lib/TypeSerializer';
import addGlobalInstance from '@ulixee/commons/lib/addGlobalInstance';
import moment = require('moment');
import Extractor from './Extractor';
import IExtractorSchema, { ISchemaRecordType } from '../interfaces/IExtractorSchema';
import { IExtractorPluginConstructor } from '../interfaces/IExtractorPluginStatics';
import IExtractorContext from '../interfaces/IExtractorContext';
import ICrawlerComponents from '../interfaces/ICrawlerComponents';
import ICrawlerOutputSchema, { CrawlerOutputSchema } from '../interfaces/ICrawlerOutputSchema';
import Table from './Table';
import DatastoreInternal from './DatastoreInternal';

export default class Crawler<
  TDisableCache extends boolean = false,
  TProvidedSchema extends IExtractorSchema<unknown, never> = IExtractorSchema<unknown, never>,
  TFinalInput extends ISchemaRecordType<any> = TDisableCache extends true
    ? TProvidedSchema['input']
    : TProvidedSchema extends { input: Record<string, ISchemaAny> }
    ? typeof CrawlerInputSchema & TProvidedSchema['input']
    : typeof CrawlerInputSchema & Record<string, ISchemaAny>,
  TSchema extends IExtractorSchema<TFinalInput, typeof CrawlerOutputSchema> = IExtractorSchema<
    TFinalInput,
    typeof CrawlerOutputSchema
  >,
  TPlugin1 extends IExtractorPluginConstructor<TSchema> = IExtractorPluginConstructor<TSchema>,
  TPlugin2 extends IExtractorPluginConstructor<TSchema> = IExtractorPluginConstructor<TSchema>,
  TPlugin3 extends IExtractorPluginConstructor<TSchema> = IExtractorPluginConstructor<TSchema>,
  TContext extends Omit<IExtractorContext<TSchema>, 'Output' | 'outputs'> &
    TPlugin1['contextAddons'] &
    TPlugin2['contextAddons'] &
    TPlugin3['contextAddons'] = Omit<IExtractorContext<TSchema>, 'Output' | 'outputs'> &
    TPlugin1['contextAddons'] &
    TPlugin2['contextAddons'] &
    TPlugin3['contextAddons'],
> extends Extractor<TSchema, TPlugin1, TPlugin2, TPlugin3, TContext> {
  public static defaultMaxTimeInCache = 10 * 60e3;

  public override extractorType = 'crawler';
  public cache?: Table<{
    input: StringSchema<false>;
    sessionId: StringSchema<false>;
    crawler: StringSchema<false>;
    version: StringSchema<false>;
    runTime: DateSchema<false>;
  }>;

  private crawlerComponents: ICrawlerComponents<TSchema, TContext, TDisableCache> &
    TPlugin1['componentAddons'] &
    TPlugin2['componentAddons'] &
    TPlugin3['componentAddons'];

  constructor(
    components:
      | (ICrawlerComponents<TProvidedSchema, TContext, TDisableCache> &
          TPlugin1['componentAddons'] &
          TPlugin2['componentAddons'] &
          TPlugin3['componentAddons'])
      | (ICrawlerComponents<TProvidedSchema, TContext, TDisableCache> &
          TPlugin1['componentAddons'] &
          TPlugin2['componentAddons'] &
          TPlugin3['componentAddons'])['run'],
    ...plugins: [plugin1?: TPlugin1, plugin2?: TPlugin2, plugin3?: TPlugin3]
  ) {
    super({ ...components } as any, ...plugins);
    this.components.run = this.runWrapper.bind(this, this.components.run as any);
    this.crawlerComponents = this.components as any;
  }

  public override attachToDatastore(
    datastoreInternal: DatastoreInternal<any, any>,
    extractorName: string,
  ): void {
    super.attachToDatastore(datastoreInternal, extractorName);
    if (!this.crawlerComponents.disableCache) {
      const isBackwardsCompatible = this.crawlerComponents.backwardsCompatible ?? false;

      type TCacheTable = this['cache'];
      this.cache = new Table({
        isPublic: false,
        name: `crawler_cache_${extractorName}`,
        schema: {
          input: string({ description: 'TypeSerialized json of the inputs' }),
          sessionId: string({
            description: 'The scraper specific session id generated by toCrawlerOutput.',
          }),
          crawler: string(),
          version: string({ description: 'The crawler version.' }),
          runTime: date({ past: true, description: 'The time this session was run.' }),
        },
        async onVersionMigrated(previousVersion: TCacheTable) {
          if (isBackwardsCompatible) {
            await this.insertInternal(...(await previousVersion.fetchInternal()));
          }
        },
      });
      datastoreInternal.attachTable(this.cache);
    }
  }

  protected async runWrapper(
    originalRun: ICrawlerComponents<TSchema, TContext>['run'],
    context: TContext,
  ): Promise<void> {
    const {
      outputs: _o,
      Output,
      datastoreMetadata: _d,
      input,
      schema,
      ...rest
    } = context as IExtractorContext<TSchema>;
    const cached = await this.findCached(input as TContext['input']);
    if (cached) {
      Output.emit(cached as any);
      return;
    }

    const result = await originalRun({ input, schema, ...rest } as any);
    const output = await result.toCrawlerOutput();
    Output.emit(output as any);
    await this.saveToCache(input as TContext['input'], output);
  }

  protected async saveToCache(
    input: TContext['input'],
    output: ICrawlerOutputSchema,
  ): Promise<void> {
    if (this.crawlerComponents.disableCache || !output.sessionId) return null;
    const serializedInput = this.getSerializedInput(input);
    await this.cache.queryInternal('DELETE FROM self WHERE input=$1', [serializedInput]);

    const data = {
      input: serializedInput,
      ...output,
      runTime: new Date(),
    };

    const fields = Object.keys(data);
    const fieldKeys = fields.map((_, i) => `$${i + 1}`);

    await this.cache.queryInternal(
      `INSERT INTO self (${fields.join(', ')}) VALUES (${fieldKeys.join(', ')})`,
      Object.values(data),
    );
  }

  protected async findCached(input: TContext['input']): Promise<ICrawlerOutputSchema> {
    if (this.crawlerComponents.disableCache) return null;
    (input as ICrawlerInputSchema).maxTimeInCache ??= Crawler.defaultMaxTimeInCache;

    const maxAge = moment().add(-input.maxTimeInCache, 'seconds').toISOString();
    const serializedInput = this.getSerializedInput(input);

    const cached = await this.cache.queryInternal(
      `SELECT * FROM self WHERE runTime >= $1 AND input=$2 LIMIT 1`,
      [maxAge, serializedInput],
    );
    if (cached.length) {
      const [{ sessionId, version, crawler }] = cached;
      return { sessionId, version, crawler };
    }
    return null;
  }

  protected getSerializedInput(input: TContext['input']): string {
    const { maxTimeInCache: _m, sessionId: _s, ...inputArgs } = input;
    return TypeSerializer.stringify(inputArgs, { sortKeys: true });
  }
}

addGlobalInstance(Crawler);

const CrawlerInputSchema = {
  maxTimeInCache: number({
    min: 0,
    integer: true,
    optional: true,
    description: 'The maximum age in seconds of a cached web session.',
  }),
};

interface ICrawlerInputSchema {
  maxTimeInCache?: number;
}
