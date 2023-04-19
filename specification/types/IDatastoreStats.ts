import { z } from '@ulixee/specification';

const positiveInt = z.number().int().positive();
export const DatastoreStatsSchema = z.object({
  queries: positiveInt.describe('Total number of queries'),
  errors: positiveInt.describe('Total number of errors'),
  totalSpend: positiveInt.describe('Total microgons spent.'),
  totalCreditSpend: positiveInt.describe(
    'Total credits spent in microgons (this number is included in totalSpend).',
  ),
  averageBytesPerQuery: positiveInt.describe('Average bytes of output returned per query.'),
  maxBytesPerQuery: positiveInt.describe('The largest byte count seen.'),
  averageMilliseconds: positiveInt.describe('Average milliseconds spent before response.'),
  maxMilliseconds: positiveInt.describe('Max milliseconds spent before response.'),
  averageTotalPricePerQuery: positiveInt.describe('Average total microgons paid for a query.'),
  maxPricePerQuery: positiveInt.describe('The largest total microgon price seen.'),
});

type IDatastoreStats = z.infer<typeof DatastoreStatsSchema>;

export default IDatastoreStats;
