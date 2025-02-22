import { all } from '@ulixee/commons/lib/asyncUtils';
import { sha256 } from '@ulixee/commons/lib/hashUtils';
import Resolvable from '@ulixee/commons/lib/Resolvable';
import Identity from '@ulixee/crypto/lib/Identity';
import INodeInfo from '@ulixee/platform-specification/types/INodeInfo';
import NodeId from '../interfaces/NodeId';
import { nodeIdToKadId } from '../lib/Kad';
import { PeerDistanceList } from '../lib/PeerDistanceList';
import { PeerStore } from '../lib/PeerStore';
import { IKadQueryFn, IQueryManagerInit, QueryManager } from '../lib/QueryManager';
import { RoutingTable } from '../lib/RoutingTable';
import { createNodeIds, delay } from './_helpers';

const ourIdentity = Identity.createSync();
const ourNodeId = ourIdentity.bech32;
let peers: NodeId[];
let key: Buffer;
let routingTable: RoutingTable;
const networkPingRequest = jest.fn();

beforeAll(async () => {
  key = sha256('test content');
  // sort remaining peers by XOR distance to the key, low -> high
  peers = sortClosestPeers(createNodeIds(39), key);
});

let closestPeers = peers;
beforeEach(async () => {
  routingTable = new RoutingTable(
    {
      nodeInfo: {
        nodeId: ourNodeId,
        kadId: nodeIdToKadId(ourNodeId),
        kadHost: 'localhost:1818',
        apiHost: 'localhost:1818',
      },
      network: {
        sendRequest: networkPingRequest,
      } as any,
      peerStore: {
        get(nodeId) {
          return {
            nodeId,
            kadHost: 'localhost:1818',
            apiHost: 'localhost:1818',
          };
        },
      } as PeerStore,
    },
    {},
  );
  await routingTable.start();
  jest.spyOn(routingTable, 'closestPeers').mockImplementation(() => closestPeers);
});

afterEach(async () => {
  await routingTable.stop();
});

it('simple run - succeed finding value', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 1,
      alpha: 1,
    },
  );
  await manager.start();

  const peersQueried = [];
  closestPeers = [peers[7]];
  const results = await all(
    manager.runOnClosestPeers(key, async ({ nodeInfo, signal }) => {
      // eslint-disable-line require-await
      expect(signal).toBeInstanceOf(AbortSignal);
      peersQueried.push(nodeInfo.nodeId);

      if (peersQueried.length === 1) {
        // query more peers
        return {
          closerPeers: peers.slice(0, 5).map(x => ({
            nodeId: x,
            kadHost: 'localhost:1818',
            apiHost: 'localhost:1818',
          })),
        };
      }

      if (peersQueried.length === 6) {
        // all peers queried, return result
        return {
          value: 'cool',
          closerPeers: [],
        };
      }
      // a peer that cannot help in our query
      return undefined;
    }),
  );

  // e.g. our starting peer plus the 5x closerPeers returned n the first iteration
  expect(results).toHaveLength(6);

  expect(results.find(x => x.value === 'cool')).toBeTruthy();
  // should be a result in there somewhere

  await manager.stop();
});

it('simple run - fail to find value', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 1,
      alpha: 1,
    },
  );
  await manager.start();

  const peersQueried = [];
  closestPeers = [peers[7]];
  const results = await all(
    manager.runOnClosestPeers(key, async ({ nodeInfo, signal }) => {
      // eslint-disable-line require-await
      expect(signal).toBeInstanceOf(AbortSignal);
      peersQueried.push(nodeInfo.nodeId);

      if (peersQueried.length === 1) {
        // query more peers
        return {
          closerPeers: peers.slice(0, 5).map(x => ({
            nodeId: x,
            kadHost: 'localhost:1818',
            apiHost: 'localhost:1818',
          })),
        };
      }

      // a peer that cannot help in our query
      return {};
    }),
  );

  // e.g. our starting peer plus the 5x closerPeers returned n the first iteration
  expect(results).toHaveLength(6);
  // should not be a result in there
  expect(results.every(x => !('value' in x))).toBe(true);
  expect(results.map(x => x.fromNodeId)).toEqual([peers[7], ...peers.slice(0, 5)]);

  await manager.stop();
});

it('should abort a query', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 2,
      alpha: 1,
    },
  );
  await manager.start();

  const controller = new AbortController();
  let aborted;

  // 0 -> 10 -> 11 -> 12...
  // 1 -> 20 -> 21 -> 22...
  const topology = createPeerTopology({
    0: { closerPeers: [10] },
    10: { closerPeers: [11] },
    11: { closerPeers: [12] },
    1: { closerPeers: [20] },
    20: { closerPeers: [21] },
    21: { closerPeers: [22] },
  });

  const queryFn: IKadQueryFn<any> = async ({ nodeInfo, signal }) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });

    await delay(1000);

    return topology[nodeInfo.nodeId];
  };

  closestPeers = Object.keys(topology);
  setTimeout(() => {
    controller.abort();
  }, 10);

  await expect(
    all(manager.runOnClosestPeers(key, queryFn, { signal: controller.signal })),
  ).rejects.toHaveProperty('code', 'ERR_QUERY_ABORTED');

  expect(aborted).toBeTruthy();

  await manager.stop();
});

it('does not return an error if only some queries error', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 10,
    },
  );
  await manager.start();

  let pathIndex = 0;
  const queryFn: IKadQueryFn<any> = async () => {
    pathIndex += 1;
    if (pathIndex % 2 === 0) {
      throw new Error('Urk!');
    } else {
      return null;
    }
  };

  closestPeers = peers;
  const results = await all(manager.runOnClosestPeers(key, queryFn));

  // didn't add any extra peers during the query
  expect(results).toHaveLength(manager.disjointPaths);
  // should not be a result in there
  expect(results.find(res => res.value)).not.toBeTruthy();
  // half of the results should have the error property
  expect(results.filter(res => res.error)).toHaveLength(5);

  await manager.stop();
});

it('returns empty run if initial peer list is empty', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 10,
    },
  );
  await manager.start();

  const queryFn: IKadQueryFn<any> = async () => {
    return { value: 'cool' };
  };

  closestPeers = [];
  const results = await all(manager.runOnClosestPeers(key, queryFn));

  expect(results).toHaveLength(0);

  await manager.stop();
});

it('should query closer peers first', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 1,
      alpha: 1,
    },
  );
  await manager.start();

  // 9 -> 8 -> 7 -> 6 -> 5 -> 0
  //  \-> 4 -> 3 -> 2 -> 1 -> 0     <-- should take this branch first (peers are ordered by distance to key)
  const topology = createPeerTopology({
    9: { closerPeers: [8, 4] },
    8: { closerPeers: [7] },
    7: { closerPeers: [6] },
    6: { closerPeers: [5] },
    5: { closerPeers: [0] },
    4: { closerPeers: [3] },
    3: { closerPeers: [2] },
    2: { closerPeers: [1] },
    1: { closerPeers: [0] },
    0: { value: 'hello world' },
  });

  closestPeers = [peers[9]];
  const traversedPeers: string[] = [];
  const queryFn: IKadQueryFn<any> = async ({ nodeInfo }) => {
    traversedPeers.push(nodeInfo.nodeId);
    return topology[nodeInfo.nodeId];
  };
  await all(manager.runOnClosestPeers(key, queryFn));

  expect(traversedPeers).toEqual([
    peers[9],
    peers[4],
    peers[3],
    peers[2],
    peers[1],
    peers[0],
    peers[8],
    peers[7],
    peers[6],
    peers[5],
  ]);

  await manager.stop();
});

it('should stop when passing through the same node twice', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 20,
      alpha: 1,
    },
  );
  await manager.start();

  const topology = createPeerTopology({
    6: { closerPeers: [2] },
    5: { closerPeers: [4] },
    4: { closerPeers: [3] },
    3: { closerPeers: [2] },
    2: { closerPeers: [1] },
    1: { closerPeers: [0] },
    0: { value: 'hello world' },
  });

  closestPeers = [peers[6], peers[5]];

  const traversedPeers: string[] = [];
  const queryFn: IKadQueryFn<any> = async ({ nodeInfo }) => {
    traversedPeers.push(nodeInfo.nodeId);
    return topology[nodeInfo.nodeId];
  };
  await all(manager.runOnClosestPeers(key, queryFn));
  expect(traversedPeers).toHaveLength(7);

  await manager.stop();
});

it('only closerPeers', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 1,
      alpha: 1,
    },
  );
  await manager.start();

  const queryFn: IKadQueryFn<any> = async () => {
    return {
      closerPeers: [{ nodeId: peers[2], kadHost: '', apiHost: '' }],
    };
  };

  closestPeers = [peers[3]];
  const results = await all(manager.runOnClosestPeers(key, queryFn));

  expect(results).toHaveLength(2);
  expect(results).toHaveProperty('[0].closerPeers[0].nodeId', peers[2]);
  expect(results).toHaveProperty('[1].closerPeers[0].nodeId', peers[2]);

  await manager.stop();
});

it('only closerPeers concurrent', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 3,
    },
  );
  await manager.start();

  //  9 -> 2
  //  8 -> 6 -> 4
  //       5 -> 3
  //  7 -> 1 -> 0
  const topology = createPeerTopology({
    0: { closerPeers: [] },
    1: { closerPeers: [0] },
    2: { closerPeers: [] },
    3: { closerPeers: [] },
    4: { closerPeers: [] },
    5: { closerPeers: [3] },
    6: { closerPeers: [4, 5] },
    7: { closerPeers: [1] },
    8: { closerPeers: [6] },
    9: { closerPeers: [2] },
  });

  closestPeers = [peers[9], peers[8], peers[7]];
  const queryFn: IKadQueryFn<any> = async ({ nodeInfo }) => {
    return topology[nodeInfo.nodeId];
  };
  const results = await all(manager.runOnClosestPeers(key, queryFn));

  // Should visit all peers
  expect(results).toHaveLength(10);

  await manager.stop();
});

it('should wait for the self-query query to run before running other queries', async () => {
  const initialQuerySelfHasRun = new Resolvable<void>();

  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      initialQuerySelfHasRun,
      alpha: 2,
      routingTable,
    },
  );
  await manager.start();

  let regularQueryTimeStarted = 0;
  let selfQueryTimeStarted = Infinity;

  closestPeers = [peers[7]];

  // run a regular query and the self query together
  await Promise.all([
    all(
      manager.runOnClosestPeers(key, async () => {
        // eslint-disable-line require-await
        regularQueryTimeStarted = Date.now();

        return { value: 'cool', closerPeers: [] };
      }),
    ),
    all(
      manager.runOnClosestPeers(
        key,
        async () => {
          // eslint-disable-line require-await
          selfQueryTimeStarted = Date.now();

          // make sure we take enough time so that the `regularQuery` time diff is big enough to measure
          await delay(100);

          // normally done by the QuerySelf component
          setImmediate(() => initialQuerySelfHasRun.resolve());
          return { value: 'itsme', closerPeers: [] };
        },
        {
          // this bypasses awaiting on the initialQuerySelfHasRun deferred promise
          isSelfQuery: true,
        },
      ),
    ),
  ]);

  // should have started the regular query after the self query finished
  expect(regularQueryTimeStarted).toBeGreaterThan(selfQueryTimeStarted);

  await manager.stop();
});

it('should end paths when they have no closer peers to those already queried', async () => {
  const manager = new QueryManager(
    {
      nodeId: ourNodeId,
      // @ts-expect-error
      peerStore: routingTable.kad.peerStore,
    },
    {
      ...defaultInit(),
      disjointPaths: 1,
      alpha: 1,
    },
  );
  await manager.start();

  // 3 -> 2 -> 1 -> 4 -> 5 -> 6 // should stop at 1
  const topology = createPeerTopology({
    1: { closerPeers: [4] },
    2: { closerPeers: [1] },
    3: { closerPeers: [2] },
    4: { closerPeers: [5] },
    5: { closerPeers: [6] },
    6: {},
  });

  closestPeers = [peers[3]];
  const queryFn: IKadQueryFn<any> = async ({ nodeInfo }) => {
    return topology[nodeInfo.nodeId];
  };
  const results = await all(manager.runOnClosestPeers(key, queryFn));

  // should not have a value
  expect(results.find(res => !!res.value)).not.toBeTruthy();

  const traversedPeers = results.map(x => x.fromNodeId);
  // should have traversed peers 3, 2 & 1
  expect(traversedPeers).toEqual([peers[3], peers[2], peers[1]]);

  // should not have traversed peers 4, 5 & 6
  expect(traversedPeers).not.toContain(peers[4]);
  expect(traversedPeers).not.toContain(peers[5]);
  expect(traversedPeers).not.toContain(peers[6]);

  await manager.stop();
});

function createPeerTopology(
  topology: Record<number, { closerPeers?: number[]; error?: Error; value?: any }>,
): Record<NodeId, { closerPeers?: INodeInfo[]; error?: Error; value?: any }> {
  const result: Record<NodeId, { closerPeers?: INodeInfo[]; error?: Error; value?: any }> = {};
  Object.entries(topology).forEach(([peerIndex, value]) => {
    result[peers[peerIndex]] = {
      error: value.error,
      value: value.value,
      closerPeers: value.closerPeers?.map(x => ({
        nodeId: peers[x],
        kadHost: 'localhost:1818',
        apiHost: 'localhost:1818',
      })),
    };
  });
  return result;
}

function sortClosestPeers(peerNodeIds: NodeId[], kadId: Buffer): NodeId[] {
  const peerList = new PeerDistanceList(kadId, Infinity);
  for (const peer of peerNodeIds) peerList.add(peer);
  return peerList.peers;
}

const defaultInit = (): IQueryManagerInit => {
  const init: IQueryManagerInit = {
    initialQuerySelfHasRun: new Resolvable<any>(),
    routingTable,
  };

  init.initialQuerySelfHasRun.resolve();

  return init;
};
