import ISessionResumeApi from './ISessionResumeApi';
import ISessionStepApi from './ISessionStepApi';
import ISessionUrlScreenshotApi from './ISessionUrlScreenshotApi';
import IAppBoundsChangedApi from './IAppBoundsChangedApi';
import IAppReadyApi from './IAppReadyApi';
import IMouseStateApi from './IMouseStateApi';
import ISessionQuitApi from './ISessionQuitApi';
import ISessionReplayApi from './ISessionReplayApi';

export default interface IChromeAliveApis {
  'Session.resume': ISessionResumeApi;
  'Session.replay': ISessionReplayApi;
  'Session.step': ISessionStepApi;
  'Session.quit': ISessionQuitApi;
  'Session.urlScreenshot': ISessionUrlScreenshotApi;
  'App.boundsChanged': IAppBoundsChangedApi;
  'App.ready': IAppReadyApi;
  'Mouse.state': IMouseStateApi;
}

export interface IChromeAliveApiRequest<T extends keyof IChromeAliveApis> {
  api: T;
  messageId: string;
  args: IChromeAliveApis[T]['args'];
}

export interface IChromeAliveApiResponse<T extends keyof IChromeAliveApis> {
  responseId: string;
  result: IChromeAliveApis[T]['result'];
}
