import Databox, { Function } from '@ulixee/databox';
import { IFetchMetaResponseData, IMessage, IResponse } from '../interfaces/ILocalDataboxProcess';

function sendToParent(response: IResponse): void {
  process.send(response);
}

function exit(): void {
  process.exit();
}

process.on('SIGINT', exit);
process.on('SIGTERM', exit);
process.on('SIGHUP', exit);
process.on('exit', exit);

process.on('message', async (message: IMessage) => {
  await new Promise(process.nextTick);
  if (message.action === 'fetchMeta') {
    let databox = requireDatabox(message.scriptPath);
    // wrap function in a default databox
    if (databox instanceof Function) {
      databox = new Databox<any, any>({
        functions: { default: databox },
        remoteDataboxes: {},
      });
    }
    const functionsByName: IFetchMetaResponseData['functionsByName'] = {};
    for (const [name, func] of Object.entries(
      databox.functions ?? ({} as Record<string, Function>),
    )) {
      functionsByName[name] = {
        description: func.description,
        corePlugins: func.plugins.corePlugins ?? {},
        schema: func.schema,
        pricePerQuery: func.pricePerQuery,
        addOnPricing: func.addOnPricing,
        minimumPrice: func.minimumPrice,
        ...(func.components ?? {}),
      };
    }

    const tablesByName: IFetchMetaResponseData['tablesByName'] = {};
    for (const [name, table] of Object.entries(databox.tables ?? {})) {
      tablesByName[name] = {
        description: table.description,
        schema: table.schema,
        seedlings: table.seedlings,
      };
    }

    return sendToParent({
      responseId: message.messageId,
      data: {
        name: databox.name,
        description: databox.description,
        coreVersion: databox.coreVersion,
        remoteDataboxes: databox.remoteDataboxes,
        paymentAddress: databox.paymentAddress,
        giftCardIssuerIdentity: databox.giftCardIssuerIdentity,
        functionsByName,
        tablesByName,
      },
    });
  }
  if (message.action === 'exec') {
    const databox = requireDatabox(message.scriptPath);
    const func = databox.functions[message.functionName];
    if (!func) {
      return sendToParent({
        responseId: message.messageId,
        data: {
          error: { message: `Database function "${message.functionName}" not found.` },
        },
      });
    }

    try {
      const outputs = await func.exec(message.input);

      return sendToParent({
        responseId: message.messageId,
        data: {
          outputs,
        },
      });
    } catch (error) {
      sendToParent({
        responseId: message.messageId,
        data: {
          error: { ...error },
        },
      });
    }
  }

  // @ts-ignore
  throw new Error(`unknown action: ${message.action}`);
});

function requireDatabox(scriptPath: string): Databox<any, any> {
  const imported = require(scriptPath); // eslint-disable-line import/no-dynamic-require
  const defaultExport = imported.default || imported;
  if (!defaultExport) throw new Error(`Databox script has no default export`);
  return defaultExport;
}
