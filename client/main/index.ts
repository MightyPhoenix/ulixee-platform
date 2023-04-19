import Client from './lib/Client';
import ClientForDatastore from './lib/ClientForDatastore';
import ClientForTable from './lib/ClientForTable';
import ClientForExtractor from './lib/ClientForExtractor';
import ClientForCrawler from './lib/ClientForCrawler';
import { IInputFilter, IOutputSchema } from './interfaces/IInputOutput';

export default Client;
export {
  ClientForDatastore,
  ClientForTable,
  ClientForExtractor,
  ClientForCrawler,
  IOutputSchema,
  IInputFilter,
}
