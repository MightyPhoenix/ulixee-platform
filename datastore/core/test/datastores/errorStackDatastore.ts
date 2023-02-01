import Datastore from '@ulixee/datastore';
import errorStack from './errorStack';

export default new Datastore({
  runners: {
    errorStack,
  },
});