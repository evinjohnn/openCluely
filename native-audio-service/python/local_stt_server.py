import asyncio
import websockets
from concurrent.futures import ThreadPoolExecutor
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
SLIDING_WINDOW_SEC = 0.4 # Fast pass window
SLOW_WINDOW_SEC = 2.0  # Slow pass window
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

        # Thread pool for non-blocking inference
        self.executor = ThreadPoolExecutor(max_workers=4)
        
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

    async def fast_loop(self, speaker, websocket):
        """Pass 1: Fast, low-latency, greedy decoding, creates draft text."""
        logger.info(f"Starting FAST loop for {speaker}")
        while True:
            try:
                await asyncio.sleep(0.15) 
                
                # Peek buffer
                async with self.locks[speaker]:
                    # Helper copy
                    buffer_copy = self.buffers[speaker][:]
                
                # Check if we have enough data (at least SLIDING_WINDOW_SEC)
                bytes_needed = int(SLIDING_WINDOW_SEC * SAMPLE_RATE * 2) 
                if len(buffer_copy) < bytes_needed:
                    continue

                # For Fast Pass, we don't clear the buffer, just transcribe the tail or full
                # In this continuous stream model, we just transcribe what we have.
                # To be super fast, we might limit input size if buffer gets huge, 
                # but Slow Loop manages buffer size.
                
                # Convert to numpy
                audio_array = np.frombuffer(buffer_copy, dtype=np.int16).astype(np.float32) / 32768.0
                
                # Non-blocking inference on thread pool
                loop = asyncio.get_event_loop()
                def transcribe_fast():
                    # Greedy, no VAD, beam=1
                    segments_gen, info = self.model.transcribe(
                        audio_array, 
                        beam_size=1, 
                        temperature=0.0,
                        condition_on_previous_text=False,
                        vad_filter=False, # Disable VAD for speed
                        language="en"
                    )
                    return list(segments_gen)

                segments = await loop.run_in_executor(self.executor, transcribe_fast)

                for segment in segments:
                    response = {
                        "type": "transcript",
                        "speaker": speaker,
                        "text": segment.text.strip(),
                        "final": False, # DRAFT
                        "confidence": segment.avg_logprob
                    }
                    if response["text"]:
                        await websocket.send(json.dumps(response))

            except Exception as e:
                logger.error(f"Error in FAST loop for {speaker}: {e}")
                await asyncio.sleep(1)

    async def slow_loop(self, speaker, websocket):
        """Pass 2: Slower, high accuracy, manages buffer, creates final text."""
        logger.info(f"Starting SLOW loop for {speaker}")
        while True:
            try:
                await asyncio.sleep(0.5) # Check frequency
                
                # Check if we have enough for a slow pass
                bytes_needed = int(SLOW_WINDOW_SEC * SAMPLE_RATE * 2)
                
                async with self.locks[speaker]:
                    if len(self.buffers[speaker]) < bytes_needed:
                        continue
                        
                    # Capture data to process
                    data_to_process = self.buffers[speaker][:]
                    # We DO NOT clear buffer here yet. We wait until transcription is done
                    # to safely remove the processed part while keeping new data.
                
                # Convert
                audio_array = np.frombuffer(data_to_process, dtype=np.int16).astype(np.float32) / 32768.0

                loop = asyncio.get_event_loop()
                def transcribe_slow():
                    # Accurate, VAD=True, beam=5
                    segments_gen, info = self.model.transcribe(
                        audio_array, 
                        beam_size=5, 
                        vad_filter=True, # Enable VAD for Final
                        language="en"
                    )
                    return list(segments_gen)

                segments = await loop.run_in_executor(self.executor, transcribe_slow)
 
                # Emit Final
                for segment in segments:
                    response = {
                        "type": "transcript",
                        "speaker": speaker,
                        "text": segment.text.strip(),
                        "final": True, # FINAL
                        "confidence": segment.avg_logprob
                    }
                    if response["text"]:
                        logger.info(f"FINAL [{speaker}]: {response['text']}")
                        await websocket.send(json.dumps(response))
                
                # Commit / Truncate Buffer
                # We processed len(data_to_process).
                # New data may have arrived in self.buffers[speaker].
                # We want to remove processed bytes but keep overlap.
                processed_len = len(data_to_process)
                overlap_bytes = int(OVERLAP_SEC * SAMPLE_RATE * 2)
                remove_len = max(0, processed_len - overlap_bytes)
                
                async with self.locks[speaker]:
                   # Effectively splice out the processed start
                   del self.buffers[speaker][:remove_len]

            except Exception as e:
                logger.error(f"Error in SLOW loop for {speaker}: {e}")
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
        
        user_fast = asyncio.create_task(self.fast_loop("user", websocket))
        user_slow = asyncio.create_task(self.slow_loop("user", websocket))
        
        interviewer_fast = asyncio.create_task(self.fast_loop("interviewer", websocket))
        interviewer_slow = asyncio.create_task(self.slow_loop("interviewer", websocket))
        
        try:
            await self.handle_client(websocket)
        finally:
            user_fast.cancel()
            user_slow.cancel()
            interviewer_fast.cancel()
            interviewer_slow.cancel()

if __name__ == "__main__":
    server = STTServer()
    try:
        asyncio.run(server.run_server())
    except KeyboardInterrupt:
        logger.info("Server stopping...")
