#!/bin/bash

# Exit on error
set -e

# Directory setup
# Determine script location and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
PROTO_DIR="$BASE_DIR/Protos"
SOURCES_DIR="$BASE_DIR/Sources/CopilotAudioService/Protos"
PLUGIN_GRPC="$BASE_DIR/.build/arm64-apple-macosx/release/protoc-gen-grpc-swift"
# Fallback to standard release if not found
if [ ! -f "$PLUGIN_GRPC" ]; then
    PLUGIN_GRPC="$BASE_DIR/.build/release/protoc-gen-grpc-swift"
fi

PLUGIN_SWIFT=$(which protoc-gen-swift)

# Verify plugins
if [ ! -f "$PLUGIN_GRPC" ]; then
    echo "Error: protoc-gen-grpc-swift not found at $PLUGIN_GRPC"
    echo "Please run: swift build -c release --product protoc-gen-grpc-swift"
    exit 1
fi

if [ -z "$PLUGIN_SWIFT" ]; then
    echo "Error: protoc-gen-swift not found in PATH"
    echo "Please run: brew install swift-protobuf"
    exit 1
fi

echo "Setting up directories..."
mkdir -p "$PROTO_DIR/google/api"
mkdir -p "$PROTO_DIR/google/cloud/speech/v1"
mkdir -p "$PROTO_DIR/google/longrunning"
mkdir -p "$PROTO_DIR/google/rpc"
mkdir -p "$SOURCES_DIR"

# Base URL for raw content
BASE_URL="https://raw.githubusercontent.com/googleapis/googleapis/master"

download_proto() {
    local path=$1
    echo "Downloading $path..."
    curl -s -o "$PROTO_DIR/$path" "$BASE_URL/$path"
}

# Download protos
# Download protos
download_proto "google/cloud/speech/v2/cloud_speech.proto"
download_proto "google/cloud/speech/v2/locations_metadata.proto"
download_proto "google/api/annotations.proto"
download_proto "google/api/http.proto"
download_proto "google/api/client.proto"
download_proto "google/api/field_behavior.proto"
download_proto "google/api/field_info.proto"
download_proto "google/api/resource.proto"
download_proto "google/longrunning/operations.proto"
download_proto "google/rpc/status.proto"

# Note: built-in google/protobuf/*.proto are included with protoc

echo "Generating Swift code..."

# Generate Config
protoc \
    --proto_path="$PROTO_DIR" \
    --swift_out="$SOURCES_DIR" \
    --swift_opt=Visibility=Public \
    --grpc-swift_out="$SOURCES_DIR" \
    --grpc-swift_opt=Visibility=Public \
    --plugin=protoc-gen-grpc-swift="$PLUGIN_GRPC" \
    --plugin=protoc-gen-swift="$PLUGIN_SWIFT" \
    "$PROTO_DIR/google/cloud/speech/v2/cloud_speech.proto" \
    "$PROTO_DIR/google/cloud/speech/v2/locations_metadata.proto" \
    "$PROTO_DIR/google/longrunning/operations.proto" \
    "$PROTO_DIR/google/rpc/status.proto"

echo "Done! Generated files in $SOURCES_DIR"
