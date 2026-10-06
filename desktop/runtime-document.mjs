/** Document loading capability for the trusted IDE only, never its runtimes.
 * Restrictive CSP, IPC sender checks and iframe sandboxing remain enforced by
 * the existing native host. Only its private, unguessable preview URLs may be
 * loaded: never privileged IDE assets, remote URLs or alternate authorities.
 * See https://www.electronjs.org/docs/latest/tutorial/security
 */
export function createNativeRuntimeDocumentLoader(bridge) {
  if (typeof bridge?.runtimeDocument !== 'function') throw new Error('Native runtime document bridge is unavailable');
  return async html => {
    const url = await bridge.runtimeDocument(html);
    if (typeof url !== 'string' || !/^vb6:\/\/app\/preview\/[a-f0-9]{32}$/.test(url)) {
      throw new Error('Native host returned an invalid preview URL');
    }
    return url;
  };
}
