import Datastore, { Table, Runner } from '@ulixee/datastore';
import { boolean, string } from '@ulixee/schema';

export default new Datastore({
  runners: {
    test: new Runner({
      run(ctx) {
        new ctx.Output({
          testerEcho: ctx.input.shouldTest,
          greeting: 'Hello world',
        });
      },
      schema: {
        input: {
          shouldTest: boolean(),
        },
        output: {
          testerEcho: boolean(),
          greeting: string(),
        },
      },
    }),
  },
  tables: {
    testers: new Table({
      schema: {
        firstName: string(),
        lastName: string(),
        isTester: boolean(),
      },
      seedlings: [
        { firstName: 'Caleb', lastName: 'Clark', isTester: true },
        { firstName: 'Blake', lastName: 'Byrnes' }
      ]
    }),
  }
});
