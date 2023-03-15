import * as Fs from 'fs/promises';
import * as Path from 'path';
import { existsSync } from 'fs';
import DatastoreManifest from '@ulixee/datastore-core/lib/DatastoreManifest';
import { encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import { sha256 } from '@ulixee/commons/lib/hashUtils';
import IDatastoreManifest from '@ulixee/platform-specification/types/IDatastoreManifest';
import DatastorePackager from '../index';
import Dbx from '../lib/Dbx';

beforeEach(async () => {
  if (existsSync(`${__dirname}/assets/historyTest.dbx`)) {
    await Fs.rm(`${__dirname}/assets/historyTest.dbx`, { recursive: true });
  }
  if (existsSync(`${__dirname}/assets/historyTest.dbx`))
    await Fs.unlink(`${__dirname}/assets/historyTest.dbx`);
  if (existsSync(`${__dirname}/build`)) await Fs.rm(`${__dirname}/build`, { recursive: true });
});

let path: string;
afterEach(async () => {
  if (path && existsSync(path))
    await Fs.rm(path, { recursive: true }).catch(() => null);
  path = null;
});

afterAll(async () => {
  if (path && existsSync(path))
    await Fs.rm(path, { recursive: true }).catch(() => null);
});

test('it should generate a relative script entrypoint', async () => {
  const packager = new DatastorePackager(`${__dirname}/assets/historyTest.js`);
  await packager.build();
  const dbx = packager.dbx;
  path = dbx.path;

  expect(dbx.path).toBe(Path.resolve(`${__dirname}/assets/historyTest.dbx`));
  expect(packager.script).toBe(await Fs.readFile(`${dbx.path}/datastore.js`, 'utf8'));
  expect(packager.sourceMap).toBe(
    await Fs.readFile(`${dbx.path}/datastore.js.map`, 'utf8'),
  );
  await expect(
    Fs.readFile(`${dbx.path}/datastore-manifest.json`, 'utf8'),
  ).resolves.toBeTruthy();

  expect(packager.manifest.toJSON()).toEqual({
    linkedVersions: [],
    adminIdentities: [],
    crawlersByName: {},
    domain: undefined,
    scriptEntrypoint: Path.join(`packager`, `test`, `assets`, `historyTest.js`),
    scriptHash: expect.any(String),
    coreVersion: require('../package.json').version,
    schemaInterface: `{
  tables: {};
  runners: {};
  crawlers: {};
}`,
    tablesByName: {},
    runnersByName: expect.objectContaining({
      default: {
        prices: [{ perQuery: 0, minimum: 0, addOns: undefined }],
        corePlugins: {
          '@ulixee/datastore-plugins-hero': require('../package.json').version,
        },
      },
    }),
    versionHash: DatastoreManifest.createVersionHash(packager.manifest),
    versionTimestamp: expect.any(Number),
    paymentAddress: undefined,
  });
  expect((await Fs.stat(`${__dirname}/assets/historyTest.dbx`)).isDirectory()).toBeTruthy();

  await Fs.rm(dbx.path, { recursive: true });
}, 45e3);

test('should be able to modify the local built files for uploading', async () => {
  const packager = new DatastorePackager(`${__dirname}/assets/historyTest.js`);
  path = packager.dbxPath;

  const versionHash = encodeBuffer(sha256('dbxExtra'), 'dbx').substring(0, 22);
  await packager.build();
  packager.manifest.linkedVersions.push({
    versionHash,
    versionTimestamp: Date.now(),
  });
  await packager.manifest.save();

  const packager2 = new DatastorePackager(`${__dirname}/assets/historyTest.js`);
  await packager2.build();
  expect(packager2.manifest.linkedVersions.some(x => x.versionHash === versionHash)).toBeTruthy();
});

test('should be able to read a datastore manifest next to an entrypoint', async () => {
  const packager = new DatastorePackager(`${__dirname}/assets/customManifest.js`);
  path = packager.dbx.path;

  await packager.build();
  expect(packager.manifest.coreVersion).toBe('1.1.1');
});

test('should merge custom manifests', async () => {
  const packager = new DatastorePackager(`${__dirname}/assets/customManifest.js`);
  path = packager.dbx.path;

  const projectConfig = Path.resolve(__dirname, '..', '.ulixee');
  await Fs.mkdir(projectConfig, { recursive: true }).catch(() => null);
  await Fs.writeFile(
    `${projectConfig}/datastores.json`,
    JSON.stringify({
      [Path.join('..', 'test', 'assets', 'customManifest-manifest.json')]: {
        coreVersion: '1.1.2',
      },
    }),
  );

  await packager.build();
  await Fs.unlink(`${projectConfig}/datastores.json`);
  // should take the closest (entrypoint override) over the project config
  expect(packager.manifest.coreVersion).toBe('1.1.1');
});

test('should build a version history with a new version', async () => {
  const entrypoint = `${__dirname}/assets/historyTest.js`;
  const packager = new DatastorePackager(entrypoint);
  const dbx = await packager.build();
  if (packager.manifest.linkedVersions.length) {
    await packager.manifest.setLinkedVersions(entrypoint, []);
  }
  path = dbx.path;
  await Fs.writeFile(
    `${__dirname}/assets/_historytestManual.js`,
    `const {Datastore, Runner, HeroRunnerPlugin }=require("@ulixee/datastore-plugins-hero");
const heroRunner = new Runner(({output}) => {
   output.text=1;
},HeroRunnerPlugin);
module.exports = new Datastore({ runners: { heroRunner }});`,
  );
  const packager2 = new DatastorePackager(`${__dirname}/assets/historyTest.js`);
  await packager2.build({
    compiledSourcePath: Path.resolve(`${__dirname}/assets/_historytestManual.js`),
  });
  await Fs.unlink(`${__dirname}/assets/_historytestManual.js`);
  expect(packager2.manifest.linkedVersions).toHaveLength(1);
});

test('should be able to "link" the version history', async () => {
  await Fs.writeFile(
    `${__dirname}/assets/historyTest2.js`,
    `const { Datastore, Runner, HeroRunnerPlugin }=require("@ulixee/datastore-plugins-hero");
const heroRunner = new Runner(({output}) => {
   output.text=1;
},HeroRunnerPlugin);
module.exports = new Datastore({ runners: { heroRunner }})`,
  );
  const entrypoint = `${__dirname}/assets/historyTest2.js`;
  const packager = new DatastorePackager(entrypoint);
  await packager.build();
  path = packager.dbx.path;

  const [dbx1, dbx2, dbx3] = ['dbx1', 'dbx2', 'dbx3'].map(x =>
    encodeBuffer(sha256(x), 'dbx').substring(0, 22),
  );
  await packager.manifest.setLinkedVersions(entrypoint, [
    { versionHash: dbx1, versionTimestamp: Date.now() - 25e3 },
    { versionHash: dbx2, versionTimestamp: Date.now() - 30e3 },
    { versionHash: dbx3, versionTimestamp: Date.now() - 60e3 },
  ]);
  expect(packager.manifest.linkedVersions.map(x => x.versionHash)).toEqual([dbx1, dbx2, dbx3]);
});

test('should be able to change the output directory', async () => {
  const packager = new DatastorePackager(
    `${__dirname}/assets/historyTest.js`,
    `${__dirname}/build`,
  );
  path = packager.dbx.path;

  const dbx = await packager.build();
  expect(dbx.path).toBe(Path.resolve(`${__dirname}/build/historyTest.dbx`));
  expect(existsSync(dbx.path)).toBe(true);
});

test('should be able to package a multi-function Datastore', async () => {
  const packager = new DatastorePackager(`${__dirname}/assets/multiRunnerTest.js`);
  await packager.build();
  path = packager.dbx.path;
  expect(packager.manifest.toJSON()).toEqual(<IDatastoreManifest>{
    linkedVersions: [],
    scriptEntrypoint: Path.join(`packager`, `test`, `assets`, `multiRunnerTest.js`),
    scriptHash: expect.any(String),
    coreVersion: require('../package.json').version,
    tablesByName: {},
    crawlersByName: {},
    domain: undefined,
    adminIdentities: [],
    schemaInterface: `{
  tables: {};
  runners: {
    runnerWithInput: {
      input: {
        /**
         * @format url
         */
        url: string;
      };
    };
    runnerWithOutput: {
      output: {
        title: string;
        html: string;
      };
    };
  };
  crawlers: {};
}`,
    runnersByName: expect.objectContaining({
      runnerWithInput: {
        prices: [{ perQuery: 0, minimum: 0, addOns: undefined }],
        corePlugins: {
          '@ulixee/datastore-plugins-hero': require('../package.json').version,
        },
        schemaAsJson: { input: { url: { format: 'url', typeName: 'string' } } },
      },
      runnerWithOutput: {
        prices: [{ perQuery: 0, minimum: 0, addOns: undefined }],
        corePlugins: {},
        schemaAsJson: { output: { title: { typeName: 'string' }, html: { typeName: 'string' } } },
      },
    }),
    versionHash: DatastoreManifest.createVersionHash(packager.manifest),
    versionTimestamp: expect.any(Number),
    paymentAddress: undefined,
  });
  expect((await Fs.stat(`${__dirname}/assets/multiRunnerTest.dbx`)).isDirectory()).toBeTruthy();

  await Fs.rm(`${__dirname}/assets/multiRunnerTest.dbx`, { recursive: true });
});

test('should be able to package an exported Runner without a Datastore', async () => {
  const packager = new DatastorePackager(`${__dirname}/assets/rawRunnerTest.js`);
  await packager.build();
  path = packager.dbx.path;
  expect(packager.manifest.toJSON()).toEqual({
    linkedVersions: [],
    scriptEntrypoint: Path.join(`packager`, `test`, `assets`, `rawRunnerTest.js`),
    scriptHash: expect.any(String),
    coreVersion: require('../package.json').version,
    schemaInterface: `{
  tables: {};
  runners: {};
  crawlers: {};
}`,
    runnersByName: expect.objectContaining({
      default: {
        prices: [{ perQuery: 0, minimum: 0, addOns: undefined }],
        corePlugins: {
          '@ulixee/datastore-plugins-hero': require('../package.json').version,
        },
        schemaAsJson: undefined,
      },
    }),
    tablesByName: {},
    crawlersByName: {},
    domain: undefined,
    versionHash: DatastoreManifest.createVersionHash(packager.manifest),
    versionTimestamp: expect.any(Number),
    paymentAddress: undefined,
    adminIdentities: [],
  });
  expect((await Fs.stat(`${__dirname}/assets/rawRunnerTest.dbx`)).isDirectory()).toBeTruthy();

  await Fs.rm(`${__dirname}/assets/rawRunnerTest.dbx`, { recursive: true });
});
