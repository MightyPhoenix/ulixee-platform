// eslint-disable-next-line max-classes-per-file
import '@ulixee/commons/lib/SourceMapSupport';
import Hero, { HeroReplay, IHeroCreateOptions, IHeroReplayCreateOptions } from '@ulixee/hero';
import ICoreSession, { IOutputChangeToRecord } from '@ulixee/hero/interfaces/ICoreSession';
import ExtractorInternal from '@ulixee/datastore/lib/ExtractorInternal';
import { InternalPropertiesSymbol } from '@ulixee/hero/lib/internal';
import IExtractorSchema from '@ulixee/datastore/interfaces/IExtractorSchema';
import IObservableChange from '@ulixee/datastore/interfaces/IObservableChange';
import {
  Crawler,
  ExtractorPluginStatics,
  IExtractorComponents,
  IExtractorRunOptions,
} from '@ulixee/datastore';
import IExtractorContextBase from '@ulixee/datastore/interfaces/IExtractorContext';
import ICrawlerOutputSchema from '@ulixee/datastore/interfaces/ICrawlerOutputSchema';

export * from '@ulixee/datastore';

const pkg = require('./package.json');

export type IHeroExtractorRunOptions<ISchema> = IExtractorRunOptions<ISchema> & IHeroCreateOptions;

declare module '@ulixee/hero/lib/extendables' {
  interface Hero {
    toCrawlerOutput(): Promise<ICrawlerOutputSchema>;
  }
}

export type HeroReplayCrawler = typeof HeroReplay & {
  new (options: IHeroReplayCreateOptions | ICrawlerOutputSchema): HeroReplay;
  fromCrawler<T extends Crawler>(crawler: T, options?: T['runArgsType']): Promise<HeroReplay>;
};

export type IHeroExtractorContext<ISchema> = IExtractorContextBase<ISchema> & {
  Hero: typeof Hero;
  HeroReplay: HeroReplayCrawler;
};

export type IHeroExtractorComponents<ISchema> = IExtractorComponents<
  ISchema,
  IHeroExtractorContext<ISchema>
>;

@ExtractorPluginStatics
export class HeroExtractorPlugin<ISchema extends IExtractorSchema> {
  public static runArgAddons: IHeroCreateOptions;
  public static contextAddons: {
    Hero: typeof Hero;
    HeroReplay: HeroReplayCrawler;
  };

  public name = pkg.name;
  public version = pkg.version;
  public hero: Hero;
  public heroReplays = new Set<HeroReplay>();

  public extractorInternal: ExtractorInternal<ISchema, IHeroExtractorRunOptions<ISchema>>;
  public runOptions: IHeroExtractorRunOptions<ISchema>;
  public components: IHeroExtractorComponents<ISchema>;

  private pendingOutputs: IOutputChangeToRecord[] = [];
  private pendingUploadPromises = new Set<Promise<void>>();
  private coreSessionPromise: Promise<ICoreSession>;

  constructor(components: IHeroExtractorComponents<ISchema>) {
    this.components = components;
    this.uploadOutputs = this.uploadOutputs.bind(this);
  }

  public async run(
    extractorInternal: ExtractorInternal<ISchema, IHeroExtractorRunOptions<ISchema>>,
    context: IHeroExtractorContext<ISchema>,
    next: () => Promise<IHeroExtractorContext<ISchema>['outputs']>,
  ): Promise<void> {
    this.runOptions = extractorInternal.options;
    this.extractorInternal = extractorInternal;
    this.extractorInternal.onOutputChanges = this.onOutputChanged.bind(this);

    const needsClose: (() => Promise<void>)[] = [];

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const container = this;
    try {
      const HeroReplayBase = HeroReplay;

      /* eslint-disable @typescript-eslint/no-unused-vars */
      const {
        input,
        affiliateId,
        payment,
        authentication,
        trackMetadata,
        id,
        version,
        ...heroApplicableOptions
      } = extractorInternal.options as IExtractorRunOptions<ISchema>;
      /* eslint-enable @typescript-eslint/no-unused-vars */


      const heroOptions: IHeroCreateOptions = {
        ...heroApplicableOptions,
        input: this.extractorInternal.input,
      };

      const HeroBase = Hero;

      // eslint-disable-next-line @typescript-eslint/no-shadow
      context.Hero = class Hero extends HeroBase {
        constructor(options: IHeroCreateOptions = {}) {
          if (container.hero) {
            throw new Error('Multiple Hero instances are not supported in a Datastore Extractor.');
          }
          super({ ...heroOptions, ...options });
          container.hero = this;
          this.toCrawlerOutput = async (): Promise<ICrawlerOutputSchema> => {
            return {
              sessionId: await this.sessionId,
              crawler: 'Hero',
              version: this.version,
            };
          };
          void this.once('connected', container.onConnected.bind(container, this));
          needsClose.push(super.close.bind(this));
        }

        // don't close until the end
        override close(): Promise<void> {
          return Promise.resolve();
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-shadow
      context.HeroReplay = class HeroReplay extends HeroReplayBase {
        constructor(options: IHeroReplayCreateOptions) {
          const replaySessionId =
            (options as any).replaySessionId || process.env.ULX_REPLAY_SESSION_ID;

          super({
            ...heroOptions,
            ...options,
            replaySessionId,
          });
          container.heroReplays.add(this);
          this.once('connected', container.onConnected.bind(container, this));
          needsClose.push(super.close.bind(this));
        }

        // don't close until the end
        override close(): Promise<void> {
          return Promise.resolve();
        }

        static async fromCrawler<T extends Crawler>(
          crawler: T,
          options: T['runArgsType'] = {},
        ): Promise<HeroReplay> {
          if (!heroOptions.replaySessionId) {
            const crawl = await context.crawl(crawler, options);
            heroOptions.replaySessionId = crawl.sessionId;
            heroOptions.input = options.input;
          }
          return new context.HeroReplay(heroOptions);
        }
      };

      await next();

      // need to allow an immediate for directly emitted outputs to register
      await new Promise(setImmediate);
      await Promise.all(this.pendingUploadPromises);
    } finally {
      await Promise.allSettled(needsClose.map(x => x()));
    }
  }

  // INTERNALS ///////////////////////

  protected onConnected(source: Hero | HeroReplay): void {
    const coreSessionPromise = source[InternalPropertiesSymbol].coreSessionPromise;
    this.coreSessionPromise = coreSessionPromise;
    this.registerSessionClose(coreSessionPromise).catch(() => null);
    this.uploadOutputs();
  }

  protected async registerSessionClose(coreSessionPromise: Promise<ICoreSession>): Promise<void> {
    try {
      const coreSession = await coreSessionPromise;
      if (!coreSession) return;
      if (this.runOptions.trackMetadata) {
        this.runOptions.trackMetadata('heroSessionId', coreSession.sessionId, this.name);
      }
      coreSession.once('close', () => {
        if (this.coreSessionPromise === coreSessionPromise) this.coreSessionPromise = null;
      });
    } catch (err) {
      console.error(err);
      if (this.coreSessionPromise === coreSessionPromise) this.coreSessionPromise = null;
    }
  }

  protected uploadOutputs(): void {
    if (!this.pendingOutputs.length || !this.coreSessionPromise) return;

    const records = [...this.pendingOutputs];
    this.pendingOutputs.length = 0;
    const promise = this.coreSessionPromise.then(x => x.recordOutput(records)).catch(() => null);

    this.pendingUploadPromises.add(promise);
    void promise.then(() => this.pendingUploadPromises.delete(promise));
  }

  private onOutputChanged(index: number, changes: IObservableChange[]): void {
    const changesToRecord: IOutputChangeToRecord[] = changes.map(change => ({
      type: change.type as string,
      value: change.value,
      path: JSON.stringify([index, ...change.path]),
      timestamp: Date.now(),
    }));

    this.pendingOutputs.push(...changesToRecord);

    this.uploadOutputs();
  }
}
