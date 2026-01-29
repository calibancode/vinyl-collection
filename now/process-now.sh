#!/bin/bash
# Process FLAC file to now.opus and now.webp

set -e

if [ $# -eq 0 ]; then
    echo "Usage: $0 <path-to-flac-file>"
    exit 1
fi

FLAC_FILE="$1"

if [ ! -f "$FLAC_FILE" ]; then
    echo "Error: File not found: $FLAC_FILE"
    exit 1
fi

echo "Processing: $FLAC_FILE"

# Get the directory of the FLAC file
DIR=$(dirname "$FLAC_FILE")

# Extract album art and convert to webp (600x600 should be reasonable)
echo "Extracting album art..."
ffmpeg -i "$FLAC_FILE" -an -vcodec copy -f image2pipe - 2>/dev/null | \
    ffmpeg -i - -vf scale=600:600:force_original_aspect_ratio=decrease -q:v 85 "$DIR/now.webp" -y

# Encode to 128kbps opus
echo "Encoding to opus..."
ffmpeg -i "$FLAC_FILE" -c:a libopus -b:a 128k -vn "$DIR/now.opus" -y

echo ""
echo "Done! Created:"
echo "  $DIR/now.opus"
echo "  $DIR/now.webp"
echo ""
echo "Move these to the /now/ directory when ready."
