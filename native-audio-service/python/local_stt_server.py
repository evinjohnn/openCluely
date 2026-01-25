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
COMPUTE_TYPE = "int8"
SAMPLE_RATE = 16000
CHANNELS = 1
# VAD_FILTER is now contextual per loop

# Rolling buffer configuration
BUFFER_DURATION_SEC = 30 # Maintain a rolling buffer to provide context if needed, though we process in chunks
SLIDING_WINDOW_SEC = 0.4 # Fast pass window
FAST_LOOKBACK_SEC = 0.5 # Max audio to process in fast pass (tail)
SLOW_WINDOW_SEC = 2.0  # Slow pass window
OVERLAP_SEC = 0.2

class STTServer:
    def __init__(self):
        # Load Fast Model (Small.en) - Low latency, better accuracy than tiny
        logger.info("Loading FAST model (small.en) on cpu...")
        try:
            self.fast_model = WhisperModel("small.en", device="cpu", compute_type="int8")
            logger.info("Fast model loaded.")
        except Exception as e:
            logger.error(f"Failed to load fast model: {e}")
            raise

        # Load Final Model (Large-v3) - High accuracy, final quality
        logger.info("Loading FINAL model (large-v3) on cpu...")
        try:
            self.final_model = WhisperModel("large-v3", device="cpu", compute_type="int8")
            logger.info("Final model loaded.")
        except Exception as e:
            logger.error(f"Failed to load final model: {e}")
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
        # ISSUE 1 Fix: Reduced to 2 workers to prevent CPU thrashing
        self.executor = ThreadPoolExecutor(max_workers=2)
        
        # State tracking for deduplication and cursors
        self.last_fast_text = {"user": "", "interviewer": ""}
        self.slow_offsets = {"user": 0, "interviewer": 0}
        
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
        """Pass 1: Fast, low-latency, greedy decoding, creates draft text using TINY model on TAIL audio."""
        logger.info(f"Starting FAST loop for {speaker}")
        while True:
            try:
                await asyncio.sleep(0.15) 
                
                # Peek buffer
                async with self.locks[speaker]:
                    # We only care about the last FAST_LOOKBACK_SEC
                    tail_bytes = int(FAST_LOOKBACK_SEC * SAMPLE_RATE * 2)
                    if len(self.buffers[speaker]) < int(SLIDING_WINDOW_SEC * SAMPLE_RATE * 2):
                        continue
                        
                    # Take only the tail. We don't want history re-encoding for drafts.
                    buffer_tail = self.buffers[speaker][-tail_bytes:]
                
                # Convert to numpy
                audio_array = np.frombuffer(buffer_tail, dtype=np.int16).astype(np.float32) / 32768.0
                
                # Non-blocking inference on thread pool
                loop = asyncio.get_event_loop()
                def transcribe_fast():
                    # Greedy, no VAD, beam=1, using FAST MODEL
                    segments_gen, info = self.fast_model.transcribe(
                        audio_array, 
                        beam_size=1, 
                        temperature=0.0,
                        condition_on_previous_text=False,
                        vad_filter=False, # Disable VAD for speed
                        language="en"
                    )
                    return list(segments_gen)

                segments = await loop.run_in_executor(self.executor, transcribe_fast)

                # ISSUE 2 Fix: Dedup fast text
                for segment in segments:
                    text = segment.text.strip()
                    if text and text != self.last_fast_text[speaker]:
                        self.last_fast_text[speaker] = text
                        response = {
                            "type": "transcript",
                            "speaker": speaker,
                            "text": text,
                            "final": False, # DRAFT
                            "confidence": segment.avg_logprob
                        }
                        await websocket.send(json.dumps(response))

            except Exception as e:
                logger.error(f"Error in FAST loop for {speaker}: {e}")
                await asyncio.sleep(1)

    async def slow_loop(self, speaker, websocket):
        """Pass 2: Slower, high accuracy, manages buffer, creates final text using LARGE model."""
        logger.info(f"Starting SLOW loop for {speaker}")
        while True:
            try:
                await asyncio.sleep(0.5) # Check frequency
                
                # Check if we have enough for a slow pass
                bytes_needed = int(SLOW_WINDOW_SEC * SAMPLE_RATE * 2)
                
                async with self.locks[speaker]:
                    buffer_len = len(self.buffers[speaker])
                    if buffer_len < bytes_needed:
                        continue
                     
                    # ISSUE 3 Fix: Cursor-based processing logic
                    # Calculate start index based on offset and overlap
                    overlap_bytes = int(OVERLAP_SEC * SAMPLE_RATE * 2)
                    start_index = max(0, self.slow_offsets[speaker] - overlap_bytes)
                    
                    # Capture only new data + overlap
                    data_to_process = self.buffers[speaker][start_index:]
                    
                    # Update offset to current end of buffer
                    self.slow_offsets[speaker] = buffer_len
                
                # Check if we actually have enough new data to warrant a decode
                if len(data_to_process) < bytes_needed:
                    continue

                loop = asyncio.get_event_loop()
                def transcribe_slow():
                    # Accurate, VAD=True, beam=5, using FINAL MODEL
                    segments_gen, info = self.final_model.transcribe(
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
                
                # We DO NOT delete from buffer anymore to keep it simple and append-only
                # Memory usage is generally fine for typical session lengths.
                # If sessions are hours long, we might need a cleanup strategy, but for now this ensures O(N) correctness.

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
