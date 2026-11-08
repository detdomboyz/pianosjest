"""Windows CurrentUser DPAPI envelope for the private restic password copy.

No command prints a password. The recovery caller consumes unprotect() in memory.
The file is useful only with the same Windows user's DPAPI profile/credentials.
"""
import ctypes
from ctypes import wintypes
import os

HEADER = b'MJDPAPI1\0'
ENTROPY = b'melodiajest:restic:backup-password:v1'


class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data):
    backing = ctypes.create_string_buffer(data)
    return Blob(len(data), ctypes.cast(backing, ctypes.POINTER(ctypes.c_ubyte))), backing


def _dpapi(data, encrypt):
    if os.name != 'nt':
        raise OSError('CurrentUser DPAPI requires Windows')
    if type(data) is not bytes or not 1 <= len(data) <= 8192:
        raise ValueError('Invalid DPAPI input size')
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    plain, plain_backing = _blob(data)
    entropy, entropy_backing = _blob(ENTROPY)
    output = Blob()
    method = crypt.CryptProtectData if encrypt else crypt.CryptUnprotectData
    method.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    method.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not method(ctypes.byref(plain), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(output)):
        raise OSError(ctypes.get_last_error(), 'Windows DPAPI operation failed')
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))


def protect(secret):
    if type(secret) is not bytes or not 43 <= len(secret) <= 256:
        raise ValueError('Repository password length outside envelope contract')
    return HEADER + _dpapi(secret, True)


def unprotect(envelope):
    if type(envelope) is not bytes or not envelope.startswith(HEADER) or len(envelope) > 8192:
        raise ValueError('Wrong private DPAPI envelope')
    secret = _dpapi(envelope[len(HEADER):], False)
    if not 43 <= len(secret) <= 256:
        raise ValueError('Wrong decrypted password size')
    return secret
