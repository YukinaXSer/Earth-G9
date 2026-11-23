import { prepareCavePhysics } from './cave-physics.js';
self.onmessage = ({ data }) => {
  try { self.postMessage(prepareCavePhysics(data)); }
  catch (error) { self.postMessage({ error: String(error.stack ?? error) }); }
};
