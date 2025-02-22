import PaymentProcessor from '../lib/PaymentProcessor';
import { validateAuthentication } from '../lib/datastoreUtils';
import DatastoreApiHandler from '../lib/DatastoreApiHandler';

export default new DatastoreApiHandler('Datastore.queryStorageEngine', {
  async handler(request, context) {
    request.boundValues ??= [];
    const { id, payment, authentication, version, queryId } = request;

    const startTime = Date.now();
    const manifestWithEntrypoint = await context.datastoreRegistry.get(id, version);

    const storage = context.storageEngineRegistry.get(manifestWithEntrypoint, {
      id,
      version,
      payment,
      authentication,
      queryId,
    });
    const datastore = await context.vm.open(
      manifestWithEntrypoint.runtimePath,
      storage,
      manifestWithEntrypoint,
    );

    await validateAuthentication(datastore, payment, authentication);

    const paymentProcessor = new PaymentProcessor(payment, datastore, context);

    let outputs: any[];
    let runError: Error;
    try {
      outputs = await storage.query(
        request.sql,
        request.boundValues,
        { id, version, payment, authentication, queryId },
        request.virtualEntitiesByName,
      );
    } catch (error) {
      runError = error;
    }
    const resultBytes = outputs ? PaymentProcessor.getOfficialBytes(outputs) : 0;
    const microgons = await paymentProcessor.settle(resultBytes);

    const metadata = {
      bytes: resultBytes,
      microgons,
      milliseconds: Date.now() - startTime,
    };
    if (runError) throw runError;

    return {
      outputs,
      metadata,
    };
  },
});
