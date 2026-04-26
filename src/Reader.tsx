import React = require('react');
import { useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';

interface ReaderProps {
  onResult: (result: string) => void;
  constraints?: MediaTrackConstraints;
  className?: string;
  scanInterval?: number;
  onError?: (error: Error) => void;
}

const Reader: React.FC<ReaderProps> = ({
  onResult,
  constraints = { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
  className = '',
  scanInterval = 120,
  onError
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
        // Allow detecting the same QR again after it leaves the frame.
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
    <div className={`relative ${className}`}>
      <video 
        ref={videoRef} 
        className="w-full h-auto" 
        playsInline 
        muted
      />
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 w-full h-full opacity-0 pointer-events-none"
      />
    </div>
  );
};

export default Reader;