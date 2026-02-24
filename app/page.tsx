'use client';
import useCamera from './hooks/useCamera';
import SimpleCard from './components/SimpleCard';
import ChartComponent from './components/ChartComponent';
import { useState, useEffect, useRef } from 'react';
import usePPGFromSamples from './hooks/usePPGFromSamples';
import { computePPGFromRGB } from './lib/ppg';
import type { SignalCombinationMode } from './components/SignalCombinationSelector';
import SignalCombinationSelector from './components/SignalCombinationSelector';

type SegmentLabel = 'good' | 'bad';

const SEGMENT_LENGTH = 200;

export default function Home() {
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [segmentLabel, setSegmentLabel] = useState<SegmentLabel>('good');
  const [segmentStatus, setSegmentStatus] = useState<string | null>(null);
  const [inferenceResult, setInferenceResult] = useState<{
    label: string | null;
    confidence: number;
    message?: string;
  } | null>(null);

  // Inside component:
  const { videoRef, canvasRef, isRecording, setIsRecording, error } =
    useCamera();
  const [samples, setSamples] = useState<number[]>([]);
  const SAMPLES_TO_KEEP = 150; // enough for the chart in Session 2
  const [apiResponse, setApiResponse] = useState<object | null>(null);
  const { valleys, heartRate, hrv } = usePPGFromSamples(samples);
  // Inside the component:
  const [signalCombination, setSignalCombination] =
    useState<SignalCombinationMode>('default');

  async function saveRecord() {
    setSaveStatus(null);
    const record = {
      heartRate: { bpm: heartRate.bpm, confidence: heartRate.confidence },
      hrv: { sdnn: hrv.sdnn, confidence: hrv.confidence },
      ppgData: samples.slice(-200),
      timestamp: new Date().toISOString(),
    };
    try {
      const res = await fetch('/api/save-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      const data = await res.json();
      if (data.success) setSaveStatus('Saved');
      else setSaveStatus('Error: ' + (data.error || 'Unknown'));
    } catch (e) {
      setSaveStatus('Error: request failed');
    }
  }
  async function checkBackend() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setBackendStatus(
        data.ok ? 'Backend OK' : 'Backend returned unexpected data',
      );
    } catch (e) {
      setBackendStatus('Backend unreachable');
    }
  }
  async function sendLabeledSegment() {
    if (samples.length < 50) {
      setSegmentStatus('Need more samples (start recording first)');
      return;
    }
    setSegmentStatus(null);
    const ppgSegment = samples.slice(-SEGMENT_LENGTH);
    try {
      const res = await fetch('/api/save-labeled-segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ppgData: ppgSegment, label: segmentLabel }),
      });
      const data = await res.json();
      if (data.success) setSegmentStatus(`Saved as ${segmentLabel}`);
      else setSegmentStatus('Error: ' + (data.error || 'Unknown'));
    } catch {
      setSegmentStatus('Error: request failed');
    }
  }
  async function sendToApi() {
    const res = await fetch('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        samples: samples.slice(-10),
        timestamp: Date.now(),
      }),
    });
    const data = await res.json();
    setApiResponse(data);
  }

  useEffect(() => {
    const video = videoRef.current;
    const c = canvasRef.current;
    if (!isRecording || !video || !c) return;

    const ctx = c.getContext('2d');
    if (!ctx) return;

    let running = true;
    function tick() {
      if (!running || !ctx) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v?.srcObject || !v.videoWidth || !c) {
        requestAnimationFrame(tick);
        return;
      }
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      const w = 10,
        h = 10;
      const x = (c.width - w) / 2;
      const y = (c.height - h) / 2;
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      const data = ctx.getImageData(x, y, w, h).data; // RGBA: 4 values per pixel [r,g,b,a, ...]
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        pixelCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        pixelCount += 1; // red channel; default for flash + finger over camera (0–255)
      }
      const ppgValue = computePPGFromRGB(
        rSum,
        gSum,
        bSum,
        pixelCount,
        signalCombination,
      );

      setSamples((prev) => [...prev.slice(-(SAMPLES_TO_KEEP - 1)), ppgValue]);

      requestAnimationFrame(tick);
    }
    tick();
    return () => {
      running = false;
    };
  }, [isRecording]);

  // Continuous quality inference while recording (when enough samples)
  const samplesRef = useRef<number[]>([]);
  samplesRef.current = samples;
  const INFERENCE_INTERVAL_MS = 2500;
  useEffect(() => {
    if (!isRecording) return;
    let cancelled = false;
    async function run() {
      const current = samplesRef.current;
      if (current.length < SEGMENT_LENGTH) return;
      const segment = current.slice(-SEGMENT_LENGTH);
      try {
        const res = await fetch('/api/infer-quality', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ppgData: segment }),
        });
        const data = await res.json();
        if (!cancelled) {
          setInferenceResult({
            label: data.label ?? null,
            confidence: data.confidence ?? 0,
            message: data.message,
          });
        }
      } catch {
        if (!cancelled) {
          setInferenceResult({
            label: null,
            confidence: 0,
            message: 'Request failed',
          });
        }
      }
    }
    run();
    const id = setInterval(run, INFERENCE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isRecording]);

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold mb-4">Canvas sampling and POST</h1>

      {/* Camera panel: always visible; placeholder when not recording */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold mb-2">Camera</h2>
        <div className="w-96 max-w-full border border-gray-400 bg-black min-h-[240px] flex items-center justify-center overflow-hidden rounded">
          <video ref={videoRef} autoPlay muted playsInline className="hidden" />
          {isRecording ? (
            <canvas
              ref={canvasRef}
              className="w-full h-full min-h-[240px] object-contain"
            />
          ) : (
            <span className="text-gray-500 text-sm">
              Start recording to see camera
            </span>
          )}
        </div>
        <div className="mt-2">
          <button
            onClick={() => setIsRecording((r) => !r)}
            className="px-4 py-2 bg-green-500 text-white rounded"
          >
            {isRecording ? 'Stop recording' : 'Start recording'}
          </button>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </div>
      </div>

      {/* Chart, quality, and controls: layout always present */}
      <div className="mt-4">
        <ChartComponent ppgData={samples} valleys={valleys} />
        <SignalCombinationSelector
          value={signalCombination}
          onChange={setSignalCombination}
        />
        <div className="mt-2 flex flex-wrap gap-4">
          <SimpleCard
            title="Heart rate"
            value={heartRate.bpm > 0 ? `${heartRate.bpm} bpm` : '--'}
          />
          <SimpleCard
            title="Confidence"
            value={
              heartRate.confidence > 0
                ? `${heartRate.confidence.toFixed(0)}%`
                : '--'
            }
          />
        </div>
        <div className="mt-4 border-t pt-4">
          <h3 className="font-medium mb-2">Collect labeled data (for ML)</h3>
          <p className="text-sm text-gray-600 mb-2">
            Choose a label, watch the signal until it matches, then click Send
            to save this segment.
          </p>
          <div className="flex items-center gap-4 mb-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="segmentLabel"
                checked={segmentLabel === 'good'}
                onChange={() => setSegmentLabel('good')}
              />
              Good
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="segmentLabel"
                checked={segmentLabel === 'bad'}
                onChange={() => setSegmentLabel('bad')}
              />
              Bad
            </label>
          </div>
          <button
            onClick={sendLabeledSegment}
            className="px-4 py-2 bg-amber-500 text-white rounded"
          >
            Send labeled segment
          </button>
          {segmentStatus && (
            <p className="mt-2 text-sm">{segmentStatus}</p>
          )}
        </div>
        <div className="mt-4 border-t pt-4">
          <h3 className="font-medium mb-2">Signal quality (ML inference)</h3>
          <p className="text-sm text-gray-600 mb-2">
            Quality updates continuously while recording (when enough samples
            are available).
          </p>
          <div className="mt-2 text-sm">
            {inferenceResult?.message && (
              <p className="text-gray-600">{inferenceResult.message}</p>
            )}
            {inferenceResult?.label ? (
              <p>
                Predicted: <strong>{inferenceResult.label}</strong>
                {inferenceResult.confidence > 0 &&
                  ` (${(inferenceResult.confidence * 100).toFixed(0)}% confidence)`}
              </p>
            ) : (
              <p className="text-gray-500">
                {isRecording && samples.length < SEGMENT_LENGTH
                  ? 'Collecting samples…'
                  : !isRecording
                    ? 'Start recording for quality inference'
                    : '--'}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        <SimpleCard
          title="Current PPG"
          value={samples[samples.length - 1]?.toFixed(1) ?? '-'}
        />
        <SimpleCard
          title="Last 20"
          value={
            samples
              .slice(-20)
              .map((s) => s.toFixed(0))
              .join(', ') || '-'
          }
        />
      </div>
      <button
        onClick={sendToApi}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
      >
        Send to API
      </button>
      {apiResponse && (
        <pre className="mt-2 p-2 bg-gray-100 rounded text-sm">
          {JSON.stringify(apiResponse, null, 2)}
        </pre>
      )}
      <button
        onClick={checkBackend}
        className="px-4 py-2 bg-gray-500 text-white rounded mt-2"
      >
        Check backend
      </button>
      <button
        onClick={saveRecord}
        className="px-4 py-2 bg-green-500 text-white rounded mt-2"
      >
        Save record
      </button>
      {backendStatus && <p className="mt-2 text-sm">{backendStatus}</p>}
      {saveStatus && <p className="mt-2 text-sm">{saveStatus}</p>}
    </main>
  );
}
