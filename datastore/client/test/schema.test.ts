import { array, boolean, dateAdd, number, object, string, ExtractSchemaType } from '@ulixee/schema';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import * as moment from 'moment';
import { Function, FunctionSchema } from '../index';

describe('Schemas', () => {
  it('will validate input to a function', async () => {
    const schema = {
      input: {
        req: string(),
      },
    };

    const func = new Function({
      async run(ctx) {
        ctx.Output.emit({ test: true });
      },
      schema,
    });

    await expect(func.stream({ input: {} as any })).rejects.toThrowError('input did not match');
  });

  it('will supply defaults to params if not given', async () => {
    const schema = FunctionSchema({
      input: {
        plan: boolean(),
        for: number(),
        a: string({ optional: true }),
        date: string({ format: 'date' }),
      },
      inputExamples: [
        {
          date: dateAdd(1, 'days'),
          plan: true,
        },
      ],
    });

    const runResolver = new Resolvable<ExtractSchemaType<typeof schema['input']>>();
    const func = new Function({
      async run(ctx) {
        runResolver.resolve(ctx.input);
        ctx.Output.emit({ test: true });
      },
      schema,
    });

    await expect(func.stream({ input: { plan: false, for: 1 } } as any)).resolves.toBeTruthy();
    const input = await runResolver;
    expect(input.date).toBe(moment().add(1, 'days').format('YYYY-MM-DD'));
    expect(input.plan).toBe(false);
    expect(input.a).toBeUndefined();
  });

  it('will validate output errors for a function', async () => {
    const schema = {
      output: {
        test: string(),
      },
    };

    const func = new Function({
      async run(ctx) {
        // @ts-expect-error
        ctx.Output.emit({ test: 1 });
      },
      schema,
    });

    await expect(func.stream({})).rejects.toThrowError('Output did not match');
  });

  it('will validate output and abort at the first error', async () => {
    const schema = {
      output: {
        str: string(),
        arr: array(
          object({
            num: number(),
            bool: boolean(),
          }),
        ),
      },
    };

    let counter = 0;
    const func = new Function({
      schema,
      async run({ Output }) {
        const output = new Output();
        output.str = 'test';
        counter += 1;
        output.arr = [];
        counter += 1;
        // @ts-expect-error
        output.arr.push({ num: 't', bool: true });
        counter += 1;
      },
    });

    await expect(func.stream({})).rejects.toThrowError('Output did not match');
    expect(counter).toBe(2);
  });

  it('will allow valid output for a datastore', async () => {
    const schema = {
      input: {
        url: string({ format: 'url' }),
      },
      output: {
        test: string(),
      },
    };

    const func = new Function({
      async run(ctx) {
        new ctx.Output({ test: 'good to go' });
      },
      schema,
    });

    await expect(func.stream({ input: { url: 'https://url.com' } })).resolves.toEqual([
      {
        test: 'good to go',
      },
    ]);
  });
});