import React = require('react');
import { useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';

type UIVariant = 'default' | 'minimal' | 'ios' | 'clean';

interface ReaderProps {
  onResult: (result: string) => void;
  constraints?: MediaTrackConstraints;
  className?: string;
  scanInterval?: number;
  onError?: (error: Error) => void;
  variant?: UIVariant;
  showFrame?: boolean;
  frameColor?: string;
  showScanLine?: boolean;
}

const Reader: React.FC<ReaderProps> = ({
  onResult,
  constraints = { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
  className = '',
  scanInterval = 120,
  onError,
  variant = 'default',
  showFrame = true,
  frameColor = 'white',
  showScanLine = true
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isScanningRef = useRef(false);
  const isMountedRef = useRef(true);
  const previousTimeRef = useRef(0);
  const lastResultRef = useRef<string | null>(null);

  const stopAnimationLoop = useCallback(() => {
    if (requestRef.current !== null) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError?.(new Error('Camera API is not available in this environment'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      if (videoRef.current) {
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        isScanningRef.current = true;
      } else {
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch (err) {
      console.error('Error accessing the camera:', err);
      onError?.(err instanceof Error ? err : new Error('Failed to access camera'));
    }
  }, [constraints, onError]);

  const stopCamera = useCallback(() => {
    isScanningRef.current = false;
    stopAnimationLoop();

    const stream = streamRef.current ?? (videoRef.current?.srcObject as MediaStream | null);
    stream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    canvasContextRef.current = null;
  }, [stopAnimationLoop]);

  useEffect(() => {
    startCamera();
    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const scanQRCode = useCallback((timestamp: number) => {
    if (!isMountedRef.current || (typeof document !== 'undefined' && document.hidden)) {
      requestRef.current = null;
      return;
    }

    if (!isScanningRef.current || !videoRef.current || !canvasRef.current) {
      requestRef.current = requestAnimationFrame(scanQRCode);
      return;
    }

    const deltaTime = timestamp - previousTimeRef.current;
    if (deltaTime < scanInterval) {
      requestRef.current = requestAnimationFrame(scanQRCode);
      return;
    }

    previousTimeRef.current = timestamp;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      let context = canvasContextRef.current;
      if (!context) {
        context = canvas.getContext('2d', { willReadFrequently: true });
        canvasContextRef.current = context;
      }

      if (!context) {
        requestRef.current = requestAnimationFrame(scanQRCode);
        return;
      }

      const maxDimension = 720;
      const resizeRatio = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      const scaledWidth = Math.max(1, Math.floor(video.videoWidth * resizeRatio));
      const scaledHeight = Math.max(1, Math.floor(video.videoHeight * resizeRatio));

      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data !== lastResultRef.current) {
        lastResultRef.current = code.data;
        onResult(code.data);
      } else if (!code) {
        lastResultRef.current = null;
      }
    }

    requestRef.current = requestAnimationFrame(scanQRCode);
  }, [onResult, scanInterval]);

  useEffect(() => {
    isMountedRef.current = true;
    requestRef.current = requestAnimationFrame(scanQRCode);

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopAnimationLoop();
      } else if (isMountedRef.current && requestRef.current === null) {
        requestRef.current = requestAnimationFrame(scanQRCode);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopAnimationLoop();
    };
  }, [scanQRCode, stopAnimationLoop]);

  return (
    <div className={`relative w-full overflow-hidden bg-black ${className}`}>
      {/* Video element */}
      <video 
        ref={videoRef} 
        className="w-full h-auto block" 
        playsInline 
        muted
      />
      
      {/* Canvas for QR scanning */}
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 w-full h-full opacity-0 pointer-events-none"
      />
      
      {/* Frame overlay */}
      {showFrame && (
        <>
          {variant === 'ios' && <FrameIOS frameColor={frameColor} showScanLine={showScanLine} />}
          {variant === 'minimal' && <FrameMinimal frameColor={frameColor} showScanLine={showScanLine} />}
          {variant === 'clean' && <FrameClean frameColor={frameColor} showScanLine={showScanLine} />}
          {variant === 'default' && <FrameDefault frameColor={frameColor} showScanLine={showScanLine} />}
        </>
      )}
      
      {/* Scanning indicator */}
      {variant !== 'default' && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
          <ScanningIndicator variant={variant} />
        </div>
      )}
    </div>
  );
};

// Frame component - iPhone style
const FrameIOS: React.FC<{ frameColor: string; showScanLine: boolean }> = ({ frameColor, showScanLine }) => (
  <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.5) 100%)' }}>
    {/* Corner brackets */}
    <div className="absolute top-0 left-0 w-12 h-12" style={{ borderTop: `3px solid ${frameColor}`, borderLeft: `3px solid ${frameColor}` }} />
    <div className="absolute top-0 right-0 w-12 h-12" style={{ borderTop: `3px solid ${frameColor}`, borderRight: `3px solid ${frameColor}` }} />
    <div className="absolute bottom-0 left-0 w-12 h-12" style={{ borderBottom: `3px solid ${frameColor}`, borderLeft: `3px solid ${frameColor}` }} />
    <div className="absolute bottom-0 right-0 w-12 h-12" style={{ borderBottom: `3px solid ${frameColor}`, borderRight: `3px solid ${frameColor}` }} />
    
    {/* Scan line */}
    {showScanLine && <ScanLine frameColor={frameColor} />}
  </div>
);

// Frame component - Minimal style
const FrameMinimal: React.FC<{ frameColor: string; showScanLine: boolean }> = ({ frameColor, showScanLine }) => (
  <div className="absolute inset-0 pointer-events-none">
    <div className="absolute inset-0 border-2" style={{ borderColor: frameColor, opacity: 0.3 }} />
    {showScanLine && <ScanLine frameColor={frameColor} opacity={0.2} />}
  </div>
);

// Frame component - Clean style
const FrameClean: React.FC<{ frameColor: string; showScanLine: boolean }> = ({ frameColor, showScanLine }) => (
  <div className="absolute inset-0 pointer-events-none">
    {/* Grid overlay */}
    <div className="absolute inset-0" style={{
      backgroundImage: `linear-gradient(${frameColor} 1px, transparent 1px), linear-gradient(90deg, ${frameColor} 1px, transparent 1px)`,
      backgroundSize: '33.33% 33.33%',
      opacity: 0.1
    }} />
    
    {/* Rounded frame */}
    <div className="absolute inset-8 rounded-3xl" style={{ border: `2px solid ${frameColor}`, opacity: 0.5 }} />
    
    {/* Corner dots */}
    <div className="absolute top-12 left-12 w-2 h-2 rounded-full bg-white opacity-50" />
    <div className="absolute top-12 right-12 w-2 h-2 rounded-full bg-white opacity-50" />
    <div className="absolute bottom-12 left-12 w-2 h-2 rounded-full bg-white opacity-50" />
    <div className="absolute bottom-12 right-12 w-2 h-2 rounded-full bg-white opacity-50" />
    
    {showScanLine && <ScanLine frameColor={frameColor} />}
  </div>
);

// Frame component - Default style
const FrameDefault: React.FC<{ frameColor: string; showScanLine: boolean }> = ({ frameColor, showScanLine }) => (
  <div className="absolute inset-0 pointer-events-none">
    <div className="absolute inset-1/4 border-2" style={{ borderColor: frameColor }} />
    {showScanLine && <ScanLine frameColor={frameColor} />}
  </div>
);

// Animated scan line
const ScanLine: React.FC<{ frameColor: string; opacity?: number }> = ({ frameColor, opacity = 0.6 }) => {
  const scanLineStyle = `
    @keyframes scan {
      0% { top: 0; }
      100% { top: 100%; }
    }
    .qr-scan-line {
      animation: scan 2s infinite;
      position: absolute;
      left: 0;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, transparent, ${frameColor}, transparent);
      box-shadow: 0 0 10px ${frameColor};
      opacity: ${opacity};
    }
  `;
  
  return (
    <>
      <style>{scanLineStyle}</style>
      <div className="qr-scan-line" />
    </>
  );
};

// Scanning indicator with dot animation
const ScanningIndicator: React.FC<{ variant: UIVariant }> = ({ variant }) => {
  const indicatorStyle = `
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    @keyframes pulse-ring {
      0% { 
        transform: scale(0.8);
        opacity: 1;
      }
      100% { 
        transform: scale(1.2);
        opacity: 0;
      }
    }
    .qr-pulse-dot {
      animation: pulse-dot 1s infinite;
    }
    .qr-pulse-ring {
      animation: pulse-ring 1.5s infinite;
    }
  `;
  
  return (
    <>
      <style>{indicatorStyle}</style>
      <div className="flex items-center gap-3">
        <div className="relative w-3 h-3">
          <div className="qr-pulse-ring absolute inset-0 rounded-full border border-blue-400" />
          <div className="qr-pulse-dot absolute inset-0.5 rounded-full bg-blue-400" />
        </div>
        <span className="text-white text-xs font-medium tracking-wide">
          {variant === 'ios' && 'Scanning'}
          {variant === 'minimal' && 'Ready'}
          {variant === 'clean' && 'Active'}
        </span>
      </div>
    </>
  );
};

export default Reader;