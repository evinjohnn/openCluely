import Foundation
import Dispatch

/// Entry point for the Copilot Audio Service
struct Main {
    static func main() {
        // Parse command line arguments
        let arguments = CommandLine.arguments
        
        if arguments.contains("--help") || arguments.contains("-h") {
            printUsage()
            return
        }
        
        if arguments.contains("--version") || arguments.contains("-v") {
            print("Copilot Audio Service v1.0.0")
            return
        }
        
        // Set log level from environment
        if let logLevel = ProcessInfo.processInfo.environment["COPILOT_LOG_LEVEL"] {
            switch logLevel.lowercased() {
            case "debug":
                Logger.minLevel = .debug
            case "info":
                Logger.minLevel = .info
            case "warning", "warn":
                Logger.minLevel = .warning
            case "error":
                Logger.minLevel = .error
            default:
                break
            }
        }
        
        Logger.log("===========================================", level: .info)
        Logger.log("  Copilot Audio Service Starting", level: .info)
        Logger.log("===========================================", level: .info)
        
        // Load configuration
        let config = ServiceConfig.load()
        
        Logger.log("Configuration:", level: .info)
        Logger.log("  IPC Port: \(config.ipcPort)", level: .info)
        Logger.log("  Virtual Device: \(config.virtualDeviceUID)", level: .info)
        Logger.log("  STT Endpoint: \(config.sttEndpoint.prefix(50))...", level: .info)
        Logger.log("  Context Window: \(config.contextWindowDuration)s", level: .info)
        
        // Validate Google credentials for gRPC
        let googleCreds = ProcessInfo.processInfo.environment["GOOGLE_APPLICATION_CREDENTIALS"] ?? ""
        guard !googleCreds.isEmpty else {
            Logger.log("ERROR: Google credentials not configured", level: .error)
            Logger.log("Set GOOGLE_APPLICATION_CREDENTIALS environment variable to your service account JSON", level: .error)
            Logger.log("Example: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json", level: .error)
            exit(1)
        }
        
        Logger.log("  Google Credentials: \(googleCreds)", level: .info)
        
        // Create and start service
        let service = CopilotAudioService(config: config)
        
        // Handle termination signals
        setupSignalHandlers(service: service)
        
        // Start the service
        service.start()
        
        // Keep the process running
        dispatchMain()
    }
    
    static func printUsage() {
        print("""
        Copilot Audio Service - Real-time conversation copilot backend
        
        USAGE:
            copilot-audio-service [OPTIONS]
        
        OPTIONS:
            -h, --help      Show this help message
            -v, --version   Show version
        
        ENVIRONMENT VARIABLES:
            GOOGLE_APPLICATION_CREDENTIALS  Path to Google service account JSON (required)
            COPILOT_IPC_PORT               WebSocket port for Electron IPC (default: 9876)
            COPILOT_VIRTUAL_DEVICE         Virtual audio device UID (default: BlackHole2ch_UID)
            COPILOT_LOG_LEVEL              Log level: debug, info, warning, error (default: info)
        
        CONFIG FILE:
            ~/.copilot-audio-service/config.json
        
        EXAMPLE:
            GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json copilot-audio-service
        """)
    }
    
    static func setupSignalHandlers(service: CopilotAudioService) {
        // Handle SIGINT (Ctrl+C)
        signal(SIGINT) { _ in
            Logger.log("Received SIGINT, shutting down...", level: .info)
            exit(0)
        }
        
        // Handle SIGTERM
        signal(SIGTERM) { _ in
            Logger.log("Received SIGTERM, shutting down...", level: .info)
            exit(0)
        }
    }
}

// Top-level entry point
Main.main()
