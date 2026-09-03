/*
 * minimaDesk: the MDS.file.* helpers of the stock hub are gone — files are picked natively and the node
 * installs straight from the absolute path (see filePathOf). Everything else is the stock MiniHUB lib.
 */

/** Absolute path of a File chosen with <input type=file> (Electron webUtils.getPathForFile). */
export function filePathOf(file: File): string {
  const p = String((window as any).minima.pathForFile(file) || '');
  if (!p) throw new Error('this file is not on disk — save it first, then choose it again');
  // the node's parser toggles quoting on a `"` inside file:"…" — refuse rather than smuggle extra params
  if (/["\r\n]/.test(p)) throw new Error('the file path contains a quote or newline — rename the file');
  return p;
}

/** Icons resolved to data URLs by AppContext.refreshAppList (self-signed MDS cert makes <img> flaky). */
const ICONS = new Map<string, string>();
export function setIconFor(uid: string, dataUrl: string) { if (dataUrl) ICONS.set(uid, dataUrl); }
export function iconFor(uid: string): string { return ICONS.get(uid) || ''; }

export function install(filePath: string) {
  return new Promise((resolve, reject) => {
    (window as any).MDS.cmd(`mds action:install file:"${filePath}"`, function (response: any) {
      if (response.status) {
        return resolve(response.response.installed);
      }

      return reject();
    });
  });
}

export function update(appUid: string, filePath: string) {
  return new Promise((resolve, reject) => {
    (window as any).MDS.cmd(`mds action:update uid:${appUid} file:"${filePath}"`, function (response: any) {
      if (response.status) {
        return resolve(response.response.updated);
      }

      return reject();
    });
  });
}

export function mds(): any {
  return new Promise((resolve, reject) => {
    (window as any).MDS.cmd('mds', function (response: any) {
      if (response.status) {
        return resolve(response.response);
      }

      return reject();
    });
  });
}

export function isWriteMode(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    (window as any).MDS.cmd(`checkmode`, function (response: any) {
      if (response.status) {
        return resolve(response.response.writemode);
      }

      return reject();
    });
  });
}

export function dAppLink(dAppName: string): any {
  return new Promise((resolve, reject) => {
    (window as any).MDS.dapplink(dAppName, function (response: any) {
      if (response.status) {
        return resolve(response);
      }

      return reject();
    });
  });
}

export function installMdsFile(filePath: string, trust: 'write' | 'read' = 'read'): Promise<string> {
  return new Promise((resolve, reject) => {
    return (window as any).MDS.cmd(`mds action:install file:"${filePath}" trust:${trust}`, function (resp) {
      if (resp.status) {
        return resolve(resp.response);
      }

      return reject();
    });
  });
}

export function uninstallApp(appUid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    return (window as any).MDS.cmd(`mds action:uninstall uid:${appUid}`, function (resp) {
      if (resp.status) {
        return resolve(resp.response);
      }

      return reject();
    });
  });
}

export function mdsActionPermission(appUid: string, trust: 'write' | 'read'): any {
  return new Promise((resolve, reject) => {
    (window as any).MDS.cmd(`mds action:permission uid:${appUid} trust:${trust}`, function (response: any) {
      if (response.status) {
        return resolve(response.response);
      }

      return reject();
    });
  });
}

export function promisfyMds(command: string): any {
  return new Promise((resolve, reject) => {
    (window as any).MDS.cmd(command, function (response: any) {
      if (response.status) {
        return resolve(response.response);
      }

      return reject();
    });
  });
}

export function quit(compact) {
  return promisfyMds(`quit compact:${compact ? 'true' : 'false'}`);
}

export function networkRecalculate() {
  return promisfyMds('network action:recalculateip');
}

export function block() {
  return promisfyMds('block');
}

export function status() {
  return promisfyMds('status');
}

export function peers() {
  return promisfyMds('peers max:5');
}

export function addPeers(peerList: string) {
  return promisfyMds(`peers action:addpeers peerslist:${peerList}`);
}

export function set(key: string, value: string) {
  return new Promise((resolve) => {
    (window as any).MDS.keypair.set(key, value, function (response: any) {
      if (response.status) {
        return resolve(response.response);
      }

      return resolve(false);
    });
  });
}

export function get(key: string) {
  return new Promise((resolve) => {
    (window as any).MDS.keypair.get(key, function (response: any) {
      if (response.status) {
        return resolve(response.value);
      }

      return resolve(false);
    });
  });
}

export function getRandomElements(arr, count) {
  // Create a shallow copy of the array to avoid modifying the original array
  const shuffled = arr.slice();

  // Shuffle the array using Fisher-Yates (Knuth) shuffle algorithm
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Return the first 'count' elements from the shuffled array
  return shuffled.slice(0, count);
}
