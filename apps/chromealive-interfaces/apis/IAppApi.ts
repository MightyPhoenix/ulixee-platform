import { IBounds } from '../IBounds';

export default interface IAppApi {
  boundsChanged(args: { bounds: IBounds; page: string }): {
    error?: Error;
  };

  ready(args: { workarea: IBounds; vueServer: string }): void;
  focus(): void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function IAppApiStatics(constructor: IAppApi) {}
