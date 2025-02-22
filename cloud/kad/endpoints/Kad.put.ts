import KadApiHandler from './KadApiHandler';

export default new KadApiHandler('Kad.put', {
  async handler(msg, context) {
    const { connection, kad, logger } = context;
    const peerNodeInfo = connection.nodeInfo;

    logger.stats('Kad.put', {
      msg,
      peerKadHost: peerNodeInfo.kadHost,
      peerNodeId: peerNodeInfo.nodeId,
    });

    const key = msg.key;

    // send a correction if we have a newer record
    const local = await kad.contentFetching.getLocal(key);
    if (local && local.timestamp > msg.record.timestamp) {
      return {
        newerRecord: local,
        closerPeers: [],
      };
    }

    const closerPeers = kad.peerRouting.getCloserPeersOffline(
      key,
      kad.nodeInfo.nodeId,
      peerNodeInfo.nodeId,
    );

    await kad.contentFetching.putLocal(key, msg.record, { needsVerify: true, isOwnRecord: false });

    return {
      closerPeers,
    };
  },
});
