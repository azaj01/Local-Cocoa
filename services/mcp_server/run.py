#!/usr/bin/env python3
"""
Standalone script to run the Local Cocoa MCP Server.

Usage:
    python run.py

Before running, make sure:
1. Local Cocoa backend is running (the main app)
2. Install dependencies: pip install mcp httpx
3. Set environment variables if needed (or let it auto-detect from local_key.txt)
"""

import asyncio
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mcp_server.server import main


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nMCP server stopped.", file=sys.stderr)
        sys.exit(0)
