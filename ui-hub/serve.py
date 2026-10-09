#!/usr/bin/env python3
"""Serve the UI hub on 127.0.0.1:8896; Markdown shows as plain text in the browser instead of downloading."""
import http.server, functools, os
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".md": "text/plain; charset=utf-8", ".webp": "image/webp"}
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 8896), functools.partial(H, directory=os.path.dirname(os.path.abspath(__file__)))).serve_forever()
