// Because there are many `postMessages` on the `host` frame, the SOURCE property
// is added to the hypothesis `postMessages` to identify the provenance of the
// message and avoid listening to messages that could have the same properties
// but different source. This is not a security feature but an
// anti-collision mechanism.
const SOURCE = 'hypothesis';

/**
 * These types are the used in by `PortProvider` and `PortFinder` for the
 * inter-frame discovery and communication processes.
 *
 * @typedef {'guest-host'|'guest-sidebar'|'host-sidebar'|'notebook-sidebar'} Channel
 * @typedef {'guest'|'host'|'notebook'|'sidebar'} Port
 *
 * @typedef Message
 * @prop {Channel} channel
 * @prop {Port} port
 * @prop {'offer'|'request'}  type
 * @prop {SOURCE} source -
 */

/**
 * Return true if an object, eg. from the data field of a `MessageEvent`, is a
 * valid `Message`.
 *
 * @param {any} data
 * @return {data is Message}
 */
function isMessageValid(data) {
  if (data === null || typeof data !== 'object') {
    return false;
  }

  for (let property of ['channel', 'port', 'source', 'type']) {
    if (typeof data[property] !== 'string') {
      return false;
    }
  }

  return data.source === SOURCE;
}

/**
 * Compares a `postMessage` data to one `Message`
 *
 * @param {any} data
 * @param {Message} message
 */
export function isMessageEqual(data, message) {
  if (!isMessageValid(data)) {
    return false;
  }

  try {
    return (
      JSON.stringify(data, Object.keys(data).sort()) ===
      JSON.stringify(message, Object.keys(message).sort())
    );
  } catch {
    return false;
  }
}
