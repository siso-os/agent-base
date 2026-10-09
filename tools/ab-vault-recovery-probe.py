#!/usr/bin/env python3
"""Synthetic-only KeePassXC restore drill; no production vault or credential input."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import struct
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
CLI = Path('/Applications/KeePassXC.app/Contents/MacOS/keepassxc-cli')
SEED_SHA256 = 'c087fd7660ddf95b4ec9355fe767c98145841abecb4f638631225225342697c9'
SEED_URL = 'https://raw.githubusercontent.com/libkeepass/pykeepass/aec256659e7b2b497a37891476241b720f60c84e/tests/test4_argon2id.kdbx'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True,
                        help='New run directory within this repo’s ignored .agents/scratchpads/')
    parser.add_argument('--seed', type=Path, required=True, help='The pinned public Argon2id test fixture in ignored scratch; its exact SHA256 is required.')
    args = parser.parse_args()
    output = args.output.expanduser().absolute()
    scratch = REPO / '.agents/scratchpads'
    if output.exists() or not output.resolve().is_relative_to(scratch.resolve()):
        parser.error('Output must be a new directory inside owned .agents/scratchpads; no existing path is modified.')
    ignored = subprocess.run(['git', 'check-ignore', '-q', str(output)], cwd=REPO)
    if ignored.returncode != 0:
        parser.error('Output must be git-ignored.')
    seed = args.seed.expanduser().absolute()
    if seed.is_symlink() or not seed.resolve().is_relative_to(scratch.resolve()):
        parser.error('Seed must be the public test fixture in owned scratch.')
    if not seed.is_file() or digest(seed) != SEED_SHA256:
        parser.error('Seed SHA256 must match the pinned public synthetic fixture; no arbitrary vault accepted.')
    age, age_keygen = shutil.which('age'), shutil.which('age-keygen')
    if not age or not age_keygen:
        parser.error('The existing age and age-keygen executables are required for the outer archive drill.')
    if not CLI.is_file():
        parser.error(f'Install the verified app first: {CLI}')
    os.umask(0o077)
    output.mkdir(parents=True, mode=0o700)
    receipt = {'schema': 1, 'scope': 'synthetic-only-local-KDBX-backup-restore',
               'at': dt.datetime.now(dt.timezone.utc).isoformat(),
               'scriptSha256': digest(Path(__file__)), 'cliPath': str(CLI),
               'cliSha256': digest(CLI), 'checks': [], 'ok': False,
               'seed': {'url': SEED_URL, 'sha256': SEED_SHA256, 'publicTestPassword': True},
               'safety': {'realVaultRead': False, 'realCredentialInput': False,
                          'clipboardUsed': False, 'keychainChanged': False,
                          'networkUsed': False, 'plaintextExportWritten': False,
                          'syntheticPassphrasePersisted': False}}
    password = 'synthetic-only-' + secrets.token_urlsafe(36)
    entry_passwords = ['synthetic-entry-' + secrets.token_urlsafe(20) for _ in range(3)]
    commands = []

    def run(command, *arguments, credentials=None, expect=0):
        result = subprocess.run([str(CLI), command, *map(str, arguments)],
                                input=credentials, text=True, capture_output=True, timeout=40,
                                env={**os.environ, 'LC_ALL': 'C'})
        # No stdin or protected values enter the receipt. Error text may include paths only.
        commands.append({'command': command, 'exitCode': result.returncode})
        if expect == 0 and result.returncode != 0:
            raise RuntimeError(f'{command} failed ({result.returncode}): {result.stderr.strip()}')
        if expect == 'reject' and result.returncode == 0:
            raise RuntimeError(f'{command} unexpectedly accepted a rejected fixture')
        return result

    def check(name, **details):
        receipt['checks'].append({'id': name, 'ok': True, **details})

    try:
        receipt['cliVersion'] = run('--version').stdout.strip()
        vault = output / 'synthetic-source.kdbx'
        shutil.copyfile(seed, vault)
        run('db-edit', '-q', '-p', vault, credentials='password\n' + password + '\n' + password + '\n')
        baseline = run('db-info', '-q', vault, credentials=password + '\n').stdout
        assert 'Number of entries: 0' in baseline, 'Pinned blank fixture unexpectedly contains entries'
        for i, value in enumerate(entry_passwords, 1):
            run('add', '-q', '-p', '-u', f'synthetic-user-{i}', '--url',
                f'https://fixture-{i}.example.invalid/', vault, f'Synthetic entry {i}',
                credentials=password + '\n' + value + '\n')
        info = run('db-info', '-q', vault, credentials=password + '\n').stdout.strip()
        receipt['sourceDatabaseInfo'] = info
        magic1, magic2, version = struct.unpack('<III', vault.read_bytes()[:12])
        assert (magic1, magic2) == (0x9AA2D903, 0xB54BFB67), 'Not a KDBX header'
        assert version >> 16 == 4, 'KDBX4 required'
        assert 'Argon2id' in info, 'Argon2id not directly observed; do not claim it'
        receipt['format'] = {'major': version >> 16, 'minor': version & 0xffff,
                             'kdf': 'Argon2id', 'evidence': 'CLI db-info and binary KDBX header',
                             'parameterScope': 'Pinned public Argon2id fixture parameters retained; not production tuning'}
        check('KDBX4-Argon2id-observed', **receipt['format'])
        expected = [f'Synthetic entry {i}' for i in range(1, 4)]
        original = run('ls', '-q', '-R', '-f', vault, credentials=password + '\n').stdout.splitlines()
        assert sorted(original) == expected, 'Unexpected source entry list'
        check('synthetic-source-has-three-entries', count=len(original))
        backup = output / 'encrypted-backup.kdbx'
        restored = output / 'restored.kdbx'
        shutil.copyfile(vault, backup)
        trusted_hash = digest(backup)
        manifest = {'synthetic': True, 'format': 'KDBX4', 'sha256': trusted_hash,
                    'entries': len(original), 'ciphertext': backup.name}
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        shutil.copyfile(backup, restored)
        assert digest(restored) == trusted_hash == digest(vault)
        check('ciphertext-backup-restores-byte-for-byte', sha256=trusted_hash)
        restored_entries = run('ls', '-q', '-R', '-f', restored, credentials=password + '\n').stdout.splitlines()
        assert restored_entries == original
        check('correct-passphrase-restores-entry-count', expected=len(original), observed=len(restored_entries))
        # Compare one actual protected value in memory, never print or persist it.
        restored_secret = run('show', '-q', '-a', 'Password', restored, expected[1],
                              credentials=password + '\n').stdout.rstrip('\n')
        assert restored_secret == entry_passwords[1]
        check('restored-protected-value-matches-in-memory')
        rejected = run('db-info', '-q', restored, credentials='synthetic-wrong-passphrase\n', expect='reject')
        check('wrong-passphrase-rejected', exitCode=rejected.returncode, diagnostic=rejected.stderr.strip())
        ciphertext = backup.read_bytes()
        # Flip ciphertext near EOF, retaining the valid KDBX header; also test truncation.
        altered = bytearray(ciphertext)
        altered[-40] ^= 0x01
        for name, content in [('tampered', bytes(altered)), ('truncated', ciphertext[:len(ciphertext)//2])]:
            invalid = output / f'{name}-backup.kdbx'
            invalid.write_bytes(content)
            assert digest(invalid) != trusted_hash
            check(f'{name}-archive-trusted-hash-rejected')
            rejected = run('db-info', '-q', invalid, credentials=password + '\n', expect='reject')
            check(f'{name}-archive-KDBX-open-rejected', exitCode=rejected.returncode,
                  diagnostic=rejected.stderr.strip())
        for item in [vault, backup, restored]:
            raw = item.read_bytes()
            assert password.encode() not in raw and all(value.encode() not in raw for value in entry_passwords)
        check('synthetic-passwords-not-plaintext-in-ciphertext')
        # Mirror Estate's optional outer age layer, using newly generated synthetic keys only.
        def age_run(executable, arguments, reject=False):
            result = subprocess.run([executable, *map(str, arguments)], capture_output=True,
                                    text=True, timeout=30)
            if (result.returncode == 0) == reject:
                raise RuntimeError('Synthetic age command had an unexpected exit status')
            return result

        receipt['ageVersion'] = age_run(age, ['--version']).stdout.strip()
        identity, wrong_identity = output / 'synthetic.agekey', output / 'wrong-synthetic.agekey'
        for key in [identity, wrong_identity]:
            age_run(age_keygen, ['-o', key])
        recipient = age_run(age_keygen, ['-y', identity]).stdout.strip()
        archive, age_restored = output / 'encrypted-backup.kdbx.age', output / 'age-restored.kdbx'
        age_run(age, ['-r', recipient, '-o', archive, backup])
        age_run(age, ['-d', '-i', identity, '-o', age_restored, archive])
        assert digest(age_restored) == trusted_hash
        age_entries = run('ls', '-q', '-R', '-f', age_restored, credentials=password + '\n').stdout.splitlines()
        assert age_entries == original
        check('age-archive-restores-KDBX-and-three-entries', count=len(age_entries), sha256=trusted_hash)
        rejected = age_run(age, ['-d', '-i', wrong_identity, '-o', output / 'wrong-key-output', archive], reject=True)
        check('age-archive-wrong-identity-rejected', exitCode=rejected.returncode)
        outer = archive.read_bytes()
        mutated = bytearray(outer)
        mutated[-12] ^= 0x01
        for name, content in [('tampered', bytes(mutated)), ('truncated', outer[:len(outer)//2])]:
            damaged = output / f'{name}-archive.age'
            damaged.write_bytes(content)
            rejected = age_run(age, ['-d', '-i', identity, '-o', output / f'{name}-age-output', damaged], reject=True)
            check(f'age-{name}-archive-rejected', exitCode=rejected.returncode)
        receipt['outerArchive'] = {'format': 'age v1', 'input': 'KDBX ciphertext only',
                                   'sha256': digest(archive), 'identityScope': 'Fresh synthetic age keys in ignored scratch only'}
        receipt['hashes'] = {f.name: digest(f) for f in output.iterdir() if f.is_file() and f.suffix != '.agekey'}
        receipt['ok'] = True
    except Exception as error:
        receipt['error'] = str(error)
    finally:
        receipt['commands'] = commands
        receipt['retention'] = 'Ignored synthetic ciphertext and receipt retained; generated passphrase exists only in this process, so this fixture is not a real recovery vault.'
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({'ok': receipt['ok'], 'checks': len(receipt['checks']),
                          'receipt': str(output / 'receipt.json'), 'error': receipt.get('error')}))
    return 0 if receipt['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
