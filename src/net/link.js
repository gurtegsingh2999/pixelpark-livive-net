import {
  NET_CONFIG,
  base64UrlToBytes,
  bytesToBase64Url,
  createAssembler,
  decodeSignalPlain,
  encodeSignalPlain,
  frameMessage
} from './protocol.js';

/**
 * Paste-a-code signaling. Compression keeps the offer small when the
 * browser can deflate it. The plain `pp1.` form is what tests round-trip.
 */
export async function encodeSignal(value) {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      return `pp1z.${bytesToBase64Url(bytes)}`;
    } catch {
      // A browser without a working deflate stream still gets a plain code.
    }
  }
  return encodeSignalPlain(value);
}

export async function decodeSignal(code) {
  const text = String(code ?? '').trim();
  if (text.startsWith('pp1z.') && typeof DecompressionStream === 'function') {
    try {
      const bytes = base64UrlToBytes(text.slice(5));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      const json = await new Response(stream).text();
      const value = JSON.parse(json);
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }
  return decodeSignalPlain(text);
}

function iceServers(stunUrls) {
  const urls = (Array.isArray(stunUrls) ? stunUrls : []).filter(url => typeof url === 'string' && url);
  if (!urls.length) return [];
  return urls.map(url => ({ urls: url }));
}

/**
 * One ordered data channel between two tabs. STUN runs only after the
 * caller builds a link, which is when play-together is opened.
 */
export function createPeerLink({ stunUrls = NET_CONFIG.stunUrls, onMessage, onStatus } = {}) {
  let pc = null;
  let channel = null;
  let stopped = false;
  const assemble = createAssembler();

  function status(name) {
    if (stopped) return;
    onStatus?.(name);
  }

  function bindChannel(next) {
    channel = next;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => status('open'));
    channel.addEventListener('close', () => status('closed'));
    channel.addEventListener('message', event => {
      let frame = null;
      try {
        frame = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      const message = assemble(frame);
      if (message) onMessage?.(message);
    });
  }

  function ensurePeer() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: iceServers(stunUrls) });
    pc.addEventListener('datachannel', event => bindChannel(event.channel));
    pc.addEventListener('connectionstatechange', () => {
      if (pc?.connectionState === 'failed') status('failed');
      else if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'closed') status('closed');
    });
    return pc;
  }

  function waitForIce() {
    if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      const timer = setTimeout(finish, 2500);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  async function localCode(kind) {
    await waitForIce();
    const description = pc.localDescription;
    if (!description?.sdp) return null;
    return encodeSignal({ kind, type: description.type, sdp: description.sdp });
  }

  return {
    async startOffer() {
      const peer = ensurePeer();
      bindChannel(peer.createDataChannel('park', { ordered: true }));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      status('gathering');
      return localCode('offer');
    },
    async acceptOffer(signal) {
      if (!signal || signal.kind !== 'offer' || typeof signal.sdp !== 'string') return null;
      const peer = ensurePeer();
      await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      status('gathering');
      return localCode('answer');
    },
    async acceptAnswer(signal) {
      if (!signal || signal.kind !== 'answer' || typeof signal.sdp !== 'string' || !pc) return false;
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      status('connecting');
      return true;
    },
    send(message) {
      if (!channel || channel.readyState !== 'open') return false;
      const frames = frameMessage(message);
      if (!frames.length) return false;
      for (const frame of frames) {
        if (channel.bufferedAmount > 1_000_000) return false;
        channel.send(JSON.stringify(frame));
      }
      return true;
    },
    close() {
      stopped = true;
      channel?.close();
      pc?.close();
      channel = null;
      pc = null;
    }
  };
}
