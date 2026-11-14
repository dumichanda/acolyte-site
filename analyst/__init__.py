"""Acolyte Analyst service."""
import socket

# Render's network has no IPv6 route, but Neon's host names also resolve to IPv6 addresses. psycopg tries every
# address it gets, and an IPv6-first answer can fail the whole connection ("Network is unreachable"). Prefer IPv4.
_getaddrinfo = socket.getaddrinfo


def _ipv4_first(host, port, family=0, type=0, proto=0, flags=0):
    res = _getaddrinfo(host, port, family, type, proto, flags)
    if family in (0, socket.AF_UNSPEC):
        v4 = [r for r in res if r[0] == socket.AF_INET]
        if v4:
            return v4
    return res


socket.getaddrinfo = _ipv4_first
