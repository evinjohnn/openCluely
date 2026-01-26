import React from 'react';
import { ArrowRight } from 'lucide-react';

interface ConnectCalendarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'dark';
}

const ConnectCalendarButton: React.FC<ConnectCalendarButtonProps> = ({ className = '', variant = 'default', ...props }) => {
    return (
        <button
            className={`
                group relative
                flex items-center gap-2.5
                pl-4 pr-5 py-2
                rounded-full
                text-[13px] font-medium
                transition-all duration-300 ease-out
                hover:brightness-125
                active:scale-[0.98]
                overflow-hidden
                ${className}
            `}
            style={{
                // Base Fill: Dark Purple
                backgroundColor: 'rgba(60, 20, 80, 0.4)',
                // Blur: Backdrop filter 12-16px
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                // Text Color
                color: '#F4F6FA',
            }}
            {...props}
        >
            {/* Gradient Border */}
            <div
                className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-300 group-hover:opacity-80"
                style={{
                    padding: '1px',
                    background: 'linear-gradient(to right, #6EA8FF, #8B7CFF)',
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                    opacity: 0.5, // 40-60% opacity
                }}
            />

            {/* Inner Highlight (Top Edge) */}
            <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                    boxShadow: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
                }}
            />

            {/* Content */}
            <span className="relative z-10 flex items-center gap-2.5 font-semibold">
                {/* Icon Placeholder or Custom SVG if needed, but using text for now as per design */}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-90">
                    <path d="M23.52 12.212c0-.848-.076-1.654-.216-2.428H12v4.594h6.473c-.28 1.503-1.12 2.775-2.38 3.619v3.01h3.84c2.247-2.07 3.54-5.118 3.54-8.795z" fill="white" />
                    <path d="M12 24c3.24 0 5.957-1.074 7.942-2.906l-3.84-3.01c-1.078.722-2.454 1.15-4.102 1.15-3.124 0-5.77-2.112-6.72-4.954H1.322v3.106C3.38 21.442 7.378 24 12 24z" fill="white" />
                    <path d="M5.28 14.28A7.276 7.276 0 0 1 4.908 12c0-.8.14-1.57.387-2.28V6.613H1.322A11.968 11.968 0 0 0 0 12c0 1.943.468 3.774 1.322 5.387l3.96-3.107z" fill="white" />
                    <path d="M12 4.75c1.764 0 3.345.607 4.588 1.795l3.433-3.434C17.95 1.258 15.234 0 12 0 7.378 0 3.378 2.558 1.322 6.613l3.957 3.107c.95-2.842 3.595-4.97 6.72-4.97z" fill="white" />
                </svg>
                Connect calendar
                <ArrowRight
                    size={13}
                    className="transition-transform group-hover:translate-x-0.5"
                    style={{ color: 'rgba(244, 246, 250, 0.9)' }} // Slightly brighter/matching text
                />
            </span>
        </button>
    );
};

export default ConnectCalendarButton;
