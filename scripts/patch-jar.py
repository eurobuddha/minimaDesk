#!/usr/bin/env python3
"""Apply minimaDesk's node-jar patches to resources/minima.jar. fetch-jar.sh runs this right after the download.

minimaDesk runs the official classic jar, built from minima-global/Minima master. Each patch replaces ONE class,
and only when the downloaded class is byte-identical to the upstream class the patch was compiled from. If upstream
has changed that class, the build stops: a person re-checks whether the fix is still needed and rebuilds the patch.
Nothing is ever patched blind.

Patches (source next to each class as patches/<Name>.java.txt):
  balance - 12 Nov 2026. A coin a MegaMMR resync restores without its token details made `balance` throw a
            NullPointerException on every call (wallet shows nothing, PandaPools cannot count or re-publish a pool).
            The details are looked up on chain, or the coin is counted as token "unknown". Same fix as
            eurobuddha/minima-core 83cabd09c37 (+ the token-script follow-up), compiled --release 8 against the
            official jar.

Pure stdlib, so it runs the same on the mac, windows and linux CI runners (the JDK's `jar uf` refuses this jar:
its module-info does not list every package).
"""
import hashlib
import os
import sys
import zipfile

JAR = "resources/minima.jar"
PATCHES = [
    # (entry in the jar, sha256 of the upstream class it replaces, sha256 of the patched class)
    ("org/minima/system/commands/base/balance.class",
     "96b8f9c72e2b654592d47943aac3887983f1df62aea80e52703b1b3670366833",
     "5d464c5fcaf16a5936757ca3700daec0c54872b4eb059f92d7717134b834f779"),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    with zipfile.ZipFile(JAR) as z:
        infos = z.infolist()
        data = {i.filename: z.read(i.filename) for i in infos}

    replace = {}
    for entry, upstream, patched in PATCHES:
        got = sha(data.get(entry, b""))
        new = open(os.path.join("patches", entry), "rb").read()
        if sha(new) != patched:
            sys.exit(f"patch-jar: patches/{entry} is not the reviewed patch (sha256 {sha(new)})")
        if got == patched:
            print(f"patch-jar: {entry} already patched")
        elif got == upstream:
            replace[entry] = new
        else:
            sys.exit(f"patch-jar: upstream {entry} changed (sha256 {got}, patch was built for {upstream}). "
                     f"Check whether the fix is still needed, then rebuild the patch.")

    if replace:
        tmp = JAR + ".patching"
        with zipfile.ZipFile(tmp, "w") as out:
            for i in infos:
                out.writestr(i, replace.get(i.filename, data[i.filename]))
        os.replace(tmp, JAR)

    with zipfile.ZipFile(JAR) as z:
        for entry, _, patched in PATCHES:
            if sha(z.read(entry)) != patched:
                sys.exit(f"patch-jar: {entry} did not land")
        if len(z.infolist()) != len(infos):
            sys.exit("patch-jar: entry count changed")
    for entry, _, patched in PATCHES:
        print(f"patch-jar: {entry} = {patched}")


if __name__ == "__main__":
    main()
