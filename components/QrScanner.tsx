'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import jsQR from 'jsqr';

export function QrScanner() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const router = useRouter();

  const stopScanner = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    setError(null);
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      const scanFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
          animationRef.current = requestAnimationFrame(scanFrame);
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          let destination: string | null = null;
          try {
            const parsed = new URL(code.data);
            if (parsed.origin === window.location.origin) {
              destination = parsed.pathname + parsed.search + parsed.hash;
            }
          } catch {
            // code.data is not an absolute URL; treat as a relative path
            if (code.data.startsWith('/')) {
              destination = code.data;
            }
          }
          if (destination) {
            stopScanner();
            router.push(destination);
          } else {
            animationRef.current = requestAnimationFrame(scanFrame);
          }
        } else {
          animationRef.current = requestAnimationFrame(scanFrame);
        }
      };
      animationRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      setScanning(false);
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('No camera found. Please connect a camera and try again.');
      } else {
        setError('Camera access denied. Please allow camera access and try again.');
      }
    }
  }, [router, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  return (
    <div className="flex flex-col items-center gap-4">
      {!scanning ? (
        <button
          onClick={startScanner}
          className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
        >
          <span>📷</span> Scan QR Code
        </button>
      ) : (
        <div className="relative w-full max-w-xs">
          <video
            ref={videoRef}
            className="w-full rounded-xl"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 border-4 border-green-500 rounded-xl pointer-events-none" />
          <button
            onClick={stopScanner}
            className="mt-3 w-full text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
    </div>
  );
}
