import { ChevronUp, ChevronDown } from "lucide-react";
import icon from "../icon.png";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
}

export default function TopPill({
    expanded,
    onToggle,
    onQuit,
}: TopPillProps) {
    return (
        <div className="w-full flex justify-center mt-2 select-none">
            <div
                className="
          draggable-area
          flex items-center gap-2
          rounded-full
          bg-[#2B2C2F]/90
          border border-white/15
          shadow-[0_6px_30px_rgba(0,0,0,0.35)]
          backdrop-blur-xl
          px-2.5 py-1.5
        "
            >
                {/* LOGO BUTTON */}
                <button
                    className="
            w-8 h-8
            rounded-full
            bg-transparent
            flex items-center justify-center
            transition-all
            hover:bg-[#2A2B2F]
            active:scale-[0.96]
            overflow-hidden
          "
                >
                    <img
                        src={icon}
                        alt="Natively"
                        className="w-full h-full object-cover"
                        draggable="false"
                        onDragStart={(e) => e.preventDefault()}
                    />
                </button>

                {/* CENTER SEGMENT */}
                <button
                    onClick={onToggle}
                    className="
            flex items-center gap-1.5
            px-5 py-2
            rounded-full
            bg-[#3A3B3F]
            text-[12px]
            font-medium
            text-white
            transition-all
            hover:bg-[#45464B]
            active:scale-[0.97]
          "
                >
                    {expanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    {expanded ? "Hide" : "Show"}
                </button>

                {/* STOP / QUIT BUTTON */}
                <button
                    onClick={onQuit}
                    className="
            w-9 h-9
            rounded-full
            bg-[#1F2023]
            flex items-center justify-center
            transition-all
            hover:bg-red-500/25
            active:scale-[0.96]
          "
                >
                    <div className="w-3.5 h-3.5 rounded-sm bg-white" />
                </button>
            </div>
        </div>
    );
}
