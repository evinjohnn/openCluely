import asyncio
import websockets
import json
import logging
import numpy as np
from faster_whisper import WhisperModel
import io
import collections
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("LocalSTTServer")

# Configuration
MODEL_SIZE = "large-v3"
DEVICE = "cpu" # Reverted to CPU as Metal is not supported by this version of ctranslate2
COMPUTE_TYPE = "int8"
SAMPLE_RATE = 16000
CHANNELS = 1
VAD_FILTER = False

# Rolling buffer configuration
BUFFER_DURATION_SEC = 30 # Maintain a rolling buffer to provide context if needed, though we process in chunks
SLIDING_WINDOW_SEC = 0.4 # Process roughly every 0.4 seconds of new audio
OVERLAP_SEC = 0.2

class STTServer:
    def __init__(self):
        logger.info(f"Loading model {MODEL_SIZE} on {DEVICE} with {COMPUTE_TYPE} quantization...")
        try:
            self.model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
            logger.info("Model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise

        # Per-speaker state
        self.buffers = {
            "user": bytearray(),
            "interviewer": bytearray()
        }
        
        # Locks for buffer access
        self.locks = {
            "user": asyncio.Lock(),
            "interviewer": asyncio.Lock()
        }

        # Background processing tasks
        self.tasks = {}

    async def handle_client(self, websocket):
        logger.info("Client connected")
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    speaker = data.get("speaker")
                    audio_hex = data.get("audio")

                    if not speaker or not audio_hex:
                        logger.warning("Invalid message format: missing speaker or audio")
                        continue

                    if speaker not in self.buffers:
                        logger.warning(f"Unknown speaker: {speaker}")
                        continue

                    # Decode audio
                    audio_bytes = bytes.fromhex(audio_hex)
                    
                    # Append to buffer
                    async with self.locks[speaker]:
                        self.buffers[speaker].extend(audio_bytes)
                        
                        # Trigger processing if enough data
                        # We trigger based on buffer size, but processing happens via independent loop or explicit trigger
                        # For simplicity, let's trigger whenever we have enough new data, 
                        # but ideally we rely on the background transcription loop.
                        # Actually, let's just push and let a loop handle it to avoid blocking the socket.

                except json.JSONDecodeError:
                    logger.error("Failed to decode JSON message")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")

        except websockets.exceptions.ConnectionClosed:
            logger.info("Client disconnected")
        finally:
            pass

    async def transcribe_loop(self, speaker, websocket):
        logger.info(f"Starting transcription loop for {speaker}")
        while True:
            try:
                await asyncio.sleep(0.15) # Check every 150ms
                
                # Check buffer
                async with self.locks[speaker]:
                    buffer_len = len(self.buffers[speaker])
                    
                # We want at least SLIDING_WINDOW_SEC of audio to process
                bytes_needed = int(SLIDING_WINDOW_SEC * SAMPLE_RATE * 2) # 16-bit
                
                if buffer_len < bytes_needed:
                    continue
                    
                # Extract audio to process with overlap
                overlap_bytes = int(OVERLAP_SEC * SAMPLE_RATE * 2)
                
                async with self.locks[speaker]:
                    data_to_process = self.buffers[speaker][:]
                    # Retain overlap for continuity
                    if len(data_to_process) > overlap_bytes:
                        self.buffers[speaker] = self.buffers[speaker][-overlap_bytes:]
                    else:
                        # Should not happen due to check above, but safely keep what we have if barely enough
                        pass 
                    
                if not data_to_process:
                    continue

                # Convert local bytes to numpy
                audio_array = np.frombuffer(data_to_process, dtype=np.int16).astype(np.float32) / 32768.0
                
                # Run inference in thread executor to avoid blocking event loop
                loop = asyncio.get_event_loop()
                # Define wrapper to unpack tuple return from model.transcribe
                def transcribe_wrapper():
                    segments_gen, info = self.model.transcribe(
                        audio_array, 
                        beam_size=1, 
                        temperature=0.0,
                        condition_on_previous_text=False,
                        vad_filter=VAD_FILTER,
                        language="en"
                    )
                    return list(segments_gen), info

                segments, info = await loop.run_in_executor(None, transcribe_wrapper)

                for segment in segments:
                    response = {
                        "type": "transcript",
                        "speaker": speaker,
                        "text": segment.text.strip(),
                        "final": True, # faster-whisper segments are generally "final" within that chunk
                        "confidence": segment.avg_logprob # Proxy for confidence (actually logprob)
                    }
                    
                    # Log and send
                    logger.info(f"TRANSCRIPT [{speaker}]: {response['text']}")
                    await websocket.send(json.dumps(response))

            except Exception as e:
                logger.error(f"Error in transcription loop for {speaker}: {e}")
                await asyncio.sleep(1)

    # Simplified approach: One shared handler that spawns loops per connection?
    # No, the requirement says "WebSocket server on ...". 
    # Usually IPC is one client (Swift app).
    
    async def run_server(self):
        async with websockets.serve(self.server_handler, "127.0.0.1", 8765):
            logger.info("WebSocket server listening on ws://127.0.0.1:8765")
            await asyncio.Future() # Run forever

    async def server_handler(self, websocket):
        # We assume one main client connection for the session
        # Start transcription loops for this connection
        
        user_task = asyncio.create_task(self.transcribe_loop("user", websocket))
        interviewer_task = asyncio.create_task(self.transcribe_loop("interviewer", websocket))
        
        try:
            await self.handle_client(websocket)
        finally:
            user_task.cancel()
            interviewer_task.cancel()

if __name__ == "__main__":
    server = STTServer()
    try:
        asyncio.run(server.run_server())
    except KeyboardInterrupt:
        logger.info("Server stopping...")
