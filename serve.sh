#!/bin/bash
# Start a local server for viewing checklists

PORT=${1:-8000}

echo "Starting server at http://localhost:$PORT"
echo "Press Ctrl+C to stop"
echo ""

python3 -m http.server $PORT
