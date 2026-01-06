#!/usr/bin/env python3
"""
Entry point for PyInstaller-packaged local_rag_agent.
This allows the FastAPI app to run as a standalone executable.
"""
import os
import sys

def main():
    import uvicorn
    from local_rag_agent.app import app
    
    host = os.getenv("LOCAL_RAG_HOST", "127.0.0.1")
    port = int(os.getenv("LOCAL_RAG_PORT", "8890"))
    
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    main()

