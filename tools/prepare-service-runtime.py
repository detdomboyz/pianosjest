"""Fetch a pinned, checksummed portable runtime without changing system Node.

This optional account-service tool writes only tmp/service-runtime. The existing
Node 20 trainer and its dependency-free startup remain independent.
"""
import hashlib
import json
import os
import sys
import tarfile
from pathlib import Path
import urllib.request
import zipfile

VERSION = 'v24.22.2'
FILE = 'node-v24.22.2-win-x64.zip'
SHA256 = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'tmp' / 'service-runtime'


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    assert not DEST.is_symlink() and DEST.resolve().is_relative_to(ROOT)
    archive = DEST / FILE
    if not archive.exists():
        with urllib.request.urlopen('https://nodejs.org/dist/' + VERSION + '/' + FILE, timeout=45) as response:
            data = response.read(100 * 1024 * 1024)
        assert hashlib.sha256(data).hexdigest() == SHA256, 'Official runtime hash mismatch'
        archive.write_bytes(data)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == SHA256
    prefix = 'node-' + VERSION + '-win-x64/'
    with zipfile.ZipFile(archive) as source:
        # Extract only the executable and the license, never executable archive paths.
        for name in ['node.exe', 'LICENSE']:
            target = DEST / name
            data = source.read(prefix + name)
            if target.exists():
                assert target.is_file() and not target.is_symlink() and target.read_bytes() == data
            else:
                target.write_bytes(data)
    proof = {'version': VERSION, 'url': 'https://nodejs.org/dist/' + VERSION + '/' + FILE,
             'archiveSha256': SHA256, 'executableSha256': hashlib.sha256((DEST / 'node.exe').read_bytes()).hexdigest(),
             'systemNodeChanged': False, 'dependenciesInstalled': False}
    if '--linux-archive' in sys.argv:
        filename='node-v24.22.2-linux-x64.tar.xz'
        expected='48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75'
        linux=DEST/filename
        if not linux.exists():
            with urllib.request.urlopen('https://nodejs.org/dist/'+VERSION+'/'+filename,timeout=45) as response:
                raw=response.read(100*1024*1024)
            assert hashlib.sha256(raw).hexdigest()==expected
            linux.write_bytes(raw)
        assert hashlib.sha256(linux.read_bytes()).hexdigest()==expected
        with tarfile.open(linux,'r:xz') as source:
            member=source.getmember('node-v24.22.2-linux-x64/bin/node')
            assert member.isfile() and member.size<=150*1024*1024
            binary=source.extractfile(member).read(member.size+1)
            assert len(binary)==member.size and binary.startswith(b'\x7fELF')
        proof.update(linuxArchive=filename,linuxArchiveBytes=linux.stat().st_size,linuxArchiveSha256=expected,linuxBinarySha256=hashlib.sha256(binary).hexdigest())
    (DEST / 'receipt.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
