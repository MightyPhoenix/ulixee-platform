import { CloudNode } from '@ulixee/cloud';
import DatastorePackager from '@ulixee/datastore-packager';
import { Helpers } from '@ulixee/datastore-testing';
import cloneDatastore from '@ulixee/datastore/cli/cloneDatastore';
import DatastoreApiClient from '@ulixee/datastore/lib/DatastoreApiClient';
import * as Fs from 'fs';
import * as Path from 'path';

const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'Datastore.clone.test');

let cloudNode: CloudNode;
let client: DatastoreApiClient;
let version: string;
let datastoreId: string;

beforeAll(async () => {
  if (Fs.existsSync(`${__dirname}/datastores/cloneme.dbx`)) {
    Fs.rmSync(`${__dirname}/datastores/cloneme.dbx`, { recursive: true });
  }

  if (Fs.existsSync(`${__dirname}/datastores/cloned.dbx`)) {
    Fs.rmSync(`${__dirname}/datastores/cloned.dbx`, { recursive: true });
  }

  cloudNode = await Helpers.createLocalNode(
    {
      datastoreConfiguration: {
        datastoresDir: storageDir,
        datastoresTmpDir: Path.join(storageDir, 'tmp'),
      },
    },
    true,
  );
  client = new DatastoreApiClient(await cloudNode.address, { consoleLogErrors: true });
  Helpers.onClose(() => client.disconnect(), true);

  const packager = new DatastorePackager(`${__dirname}/datastores/cloneme.ts`);
  await packager.build();
  await client.upload(await packager.dbx.tarGzip());
  version = packager.manifest.version;
  datastoreId = packager.manifest.id;
}, 45e3);

afterEach(Helpers.afterEach);
afterAll(Helpers.afterAll);

test('should be able to clone a datastore', async () => {
  const url = `ulx://${await cloudNode.address}/${datastoreId}@v${version}`;
  await expect(cloneDatastore(url, `${__dirname}/datastores/cloned`)).resolves.toEqual({
    datastoreFilePath: Path.join(__dirname, 'datastores', 'cloned', 'datastore.ts'),
  });

  expect(Fs.existsSync(`${__dirname}/datastores/cloned/datastore.ts`)).toBeTruthy();
  const packager = new DatastorePackager(`${__dirname}/datastores/cloned/datastore.ts`);
  await packager.build({ createTemporaryVersion: true });
  await client.upload(await packager.dbx.tarGzip());

  // should not include a private table
  expect(Object.entries(packager.manifest.tablesByName)).toHaveLength(1);
  expect(packager.manifest.tablesByName.private).not.toBeTruthy();
  expect(packager.manifest.tablesByName.users.schemaAsJson).toEqual({
    name: { typeName: 'string' },
    birthdate: { typeName: 'date' },
  });
  expect(Object.entries(packager.manifest.extractorsByName)).toHaveLength(1);
  expect(packager.manifest.extractorsByName.cloneUpstream.schemaAsJson).toEqual({
    input: {
      field: { typeName: 'string', minLength: 1, description: 'a field you should use' },
      nested: {
        typeName: 'object',
        fields: {
          field2: { typeName: 'boolean' },
        },
        optional: true,
      },
    },
    output: {
      success: { typeName: 'boolean' },
      affiliateId: { typeName: 'string' },
    },
  });

  await expect(
    client.stream(packager.manifest.id, packager.manifest.version, 'cloneUpstream', {}),
  ).rejects.toThrow('input');

  await expect(
    client.stream(packager.manifest.id, packager.manifest.version, 'cloneUpstream', {
      field: 'str',
      nested: { field2: true },
    }),
  ).resolves.toEqual([{ success: true, affiliateId: expect.any(String) }]);

  // can query the passthrough table
  await expect(
    client.query(
      packager.manifest.id,
      packager.manifest.version,
      'select * from users',
      {},
    ),
  ).resolves.toEqual({
    metadata: expect.any(Object),
    outputs: [{ name: 'me', birthdate: expect.any(Date) }],
    latestVersion: packager.manifest.version,
  });
}, 45e3);
