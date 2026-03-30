'use client';
import useCamera from './hooks/useCamera';
import SimpleCard from './components/SimpleCard';
import ChartComponent from './components/ChartComponent';
import { useState, useEffect, useRef } from 'react';
import usePPGFromSamples from './hooks/usePPGFromSamples';
import {
  computePPGFromRGB,
  SAMPLES_TO_KEEP,
  MIN_SAMPLES_FOR_DETECTION,
} from './lib/ppg';
import type { SignalCombinationMode } from './components/SignalCombinationSelector';
import SignalCombinationSelector from './components/SignalCombinationSelector';

export default function Home() {
  const { videoRef, canvasRef, isRecording, setIsRecording, error } =
    useCamera();
  const [samples, setSamples] = useState<number[]>([]);
  const [apiResponse, setApiResponse] = useState<object | null>(null);
  const { valleys, heartRate, hrv } = usePPGFromSamples(samples);
  const [signalCombination, setSignalCombination] =
    useState<SignalCombinationMode>('default');
  const signalModeRef = useRef(signalCombination);
  
  useEffect(() => {
    signalModeRef.current = signalCombination;
  }, [signalCombination]);

  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  type SegmentLabel = 'good' | 'bad';
  const [segmentLabel, setSegmentLabel] = useState<SegmentLabel>('good');
  const [segmentStatus, setSegmentStatus] = useState<string | null>(null);

  // State for Additional Work 1
  const [labeledSegments, setLabeledSegments] = useState<{ ppgData: number[]; label: string }[]>([]);

  // State and Refs for Additional Work 2
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const scalerInputRef = useRef<HTMLInputElement>(null);

  const [inferenceResult, setInferenceResult] = useState<{
    label: string | null;
    confidence: number;
    message?: string;
  } | null>(null);

  const samplesRef = useRef<number[]>([]);
  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  const INFERENCE_INTERVAL_MS = 2500;
  useEffect(() => {
    if (!isRecording) return;
    let cancelled = false;
    async function run() {
      const current = samplesRef.current;
      if (current.length < MIN_SAMPLES_FOR_DETECTION) return;
      const segment = current.slice(-SAMPLES_TO_KEEP);
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
            message: data.message ?? data.error ?? undefined,
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
    if (samples.length < MIN_SAMPLES_FOR_DETECTION) {
      setSegmentStatus('Need more samples (start recording first)');
      return;
    }
    setSegmentStatus(null);
    const ppgSegment = samples.slice(-SAMPLES_TO_KEEP);
    try {
      const res = await fetch('/api/save-labeled-segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ppgData: ppgSegment, label: segmentLabel }),
      });
      const data = await res.json();
      if (data.success) {
        setSegmentStatus(`Saved as ${segmentLabel}`);
        setLabeledSegments((prev) => [...prev, { ppgData: ppgSegment, label: segmentLabel }]);
      } else {
        setSegmentStatus('Error: ' + (data.error || 'Unknown'));
      }
    } catch {
      setSegmentStatus('Error: request failed');
    }
  }

  async function saveRecord() {
    setSaveStatus(null);
    const record = {
      heartRate: { bpm: heartRate.bpm, confidence: heartRate.confidence },
      hrv: {
        sdnn: hrv?.sdnn ?? 0,
        confidence: hrv?.confidence ?? 0,
      },
      ppgData: samples.slice(-SAMPLES_TO_KEEP),
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

  useEffect(() => {
    const video = videoRef.current;
    const c = canvasRef.current;
    if (!isRecording || !video || !c) return;
  
    const ctx = c.getContext('2d');
    if (!ctx) return;
  
    let animationFrameId: number;
  
    function tick() {
      const v = videoRef.current;
      const canvas = canvasRef.current;
      if (!v?.srcObject || v.readyState < 2 || !canvas) {
        animationFrameId = requestAnimationFrame(tick);
        return;
      }
  
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      ctx!.drawImage(v, 0, 0);
  
      const w = 10, h = 10;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;
  
      ctx!.strokeStyle = 'red';
      ctx!.lineWidth = 2;
      ctx!.strokeRect(x, y, w, h);
  
      const data = ctx!.getImageData(x, y, w, h).data;
      let rSum = 0, gSum = 0, bSum = 0, pixelCount = 0;
  
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        pixelCount += 1;
      }
  
      const ppgValue = computePPGFromRGB(
        rSum,
        gSum,
        bSum,
        pixelCount,
        signalModeRef.current,
      );
  
      setSamples((prev) => [...prev.slice(-(SAMPLES_TO_KEEP - 1)), ppgValue]);
      animationFrameId = requestAnimationFrame(tick);
    }
  
    animationFrameId = requestAnimationFrame(tick);
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isRecording]);

  function downloadLabeledJson() {
    if (labeledSegments.length === 0) return;
    const json = JSON.stringify(labeledSegments, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'labeled_records.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleUploadModel(modelFile: File | null, scalerFile: File | null) {
    if (!modelFile || !scalerFile) { 
      setUploadStatus('Select both model and scaler files'); 
      return; 
    }
    setUploadStatus("Uploading...");
    try {
      const toBase64 = (f: File) => f.arrayBuffer().then((buf) => 
        btoa(String.fromCharCode(...new Uint8Array(buf)))
      );
      const model = await toBase64(modelFile);
      const scaler = await toBase64(scalerFile);
      const res = await fetch('/api/upload-model', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ model, scaler }) 
      });
      const data = await res.json();
      setUploadStatus(res.ok && data.success ? 'Model uploaded successfully' : (data.error || 'Upload failed'));
    } catch (err) {
      setUploadStatus('Upload failed: check console');
      console.error(err);
    }
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 font-sans text-slate-700">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* HEADER SECTION */}
        <header className="text-center space-y-4 mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 text-rose-500 text-xl">
            ❤️
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">PPG Heart-Rate Monitor</h1>
          <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
            Place your finger over the camera to measure heart rate, HRV, and signal quality. 
            Collect labeled data, train your model, and upload for inference.
          </p>
        </header>
  
        {/* 1. CAMERA SECTION */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-[#10B981]" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Camera</h2>
          </div>
          
          <div className="space-y-6">
            <div className="relative w-full max-w-md aspect-video bg-black rounded-2xl overflow-hidden border border-slate-100 shadow-inner">
              <video ref={videoRef} autoPlay muted playsInline className="hidden" />
              {isRecording ? (
                <canvas ref={canvasRef} className="w-full h-full object-contain" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 text-xs font-medium">
                  Camera feed inactive
                </div>
              )}
            </div>
            
            <button
              onClick={() => setIsRecording((r) => !r)}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                isRecording 
                ? 'bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100' 
                : 'bg-[#059669] text-white hover:bg-[#047857] shadow-lg shadow-emerald-100'
              }`}
            >
              {isRecording ? 'Stop recording' : 'Start recording'}
            </button>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          </div>
        </section>
  
        {/* 2. UPLOAD MODEL SECTION */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[#6366F1]" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Upload trained model</h2>
          </div>
          <p className="text-[11px] text-slate-400 mb-6 leading-relaxed">
            After training locally (run <code className="bg-slate-100 px-1 rounded">train_quality_model.py</code> on downloaded JSON), select each file, then click Upload.
          </p>
          
          <div className="space-y-3 max-w-sm">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition text-[11px] font-bold text-slate-600 whitespace-nowrap min-w-[120px]">
                📄 Model file
                <input type="file" ref={modelInputRef} accept=".joblib" className="hidden" />
              </label>
              <span className="text-[10px] text-slate-400 truncate italic">
                {modelInputRef.current?.files?.[0]?.name ?? 'Not selected'}
              </span>
            </div>
  
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition text-[11px] font-bold text-slate-600 whitespace-nowrap min-w-[120px]">
                📄 Scaler file
                <input type="file" ref={scalerInputRef} accept=".joblib" className="hidden" />
              </label>
              <span className="text-[10px] text-slate-400 truncate italic">
                {scalerInputRef.current?.files?.[0]?.name ?? 'Not selected'}
              </span>
            </div>
  
            <button 
              onClick={() => handleUploadModel(modelInputRef.current?.files?.[0] ?? null, scalerInputRef.current?.files?.[0] ?? null)}
              className={`mt-4 px-5 py-2 text-[11px] font-black uppercase rounded-lg tracking-tight transition-all ${
                modelInputRef.current?.files?.length 
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100' 
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              ↑ Upload model
            </button>
            {uploadStatus && <p className="text-[10px] font-bold text-blue-600 uppercase mt-2">{uploadStatus}</p>}
          </div>
        </section>
  
        {/* 3. SIGNAL & METRICS SECTION */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-[#3B82F6]" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Signal & Metrics</h2>
          </div>
  
          <div className="mb-8 rounded-2xl overflow-hidden border border-slate-50">
            <ChartComponent ppgData={samples.slice(-SAMPLES_TO_KEEP)} valleys={valleys} />
          </div>
  
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Heart rate</p>
              <p className="text-2xl font-black text-slate-800">{heartRate.bpm > 0 ? heartRate.bpm : '--'}<span className="text-xs font-normal ml-1">bpm</span></p>
            </div>
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Confidence</p>
              <p className="text-2xl font-black text-slate-800">{heartRate.confidence > 0 ? heartRate.confidence.toFixed(0) : '0'}<span className="text-xs font-normal ml-1">%</span></p>
            </div>
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">HRV</p>
              <p className="text-2xl font-black text-slate-800">{hrv.sdnn > 0 ? hrv.sdnn : '--'}<span className="text-xs font-normal ml-1">ms</span></p>
            </div>
          </div>
  
          <div className="pt-4 border-t border-slate-50">
            <SignalCombinationSelector value={signalCombination} onChange={setSignalCombination} />
          </div>
        </section>
  
        {/* 4. DATA COLLECTION & INFERENCE */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Collect & Analyze</h2>
          </div>
  
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="flex-1 space-y-4">
              <p className="text-xs text-slate-500 font-medium">Select a label and save segments for training.</p>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input type="radio" checked={segmentLabel === 'good'} onChange={() => setSegmentLabel('good')} className="w-4 h-4 accent-emerald-500" />
                  <span className="text-sm font-bold text-slate-600 group-hover:text-slate-900 transition">Good</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input type="radio" checked={segmentLabel === 'bad'} onChange={() => setSegmentLabel('bad')} className="w-4 h-4 accent-rose-500" />
                  <span className="text-sm font-bold text-slate-600 group-hover:text-slate-900 transition">Bad</span>
                </label>
              </div>
              <div className="flex gap-3">
                <button onClick={sendLabeledSegment} className="px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition shadow-sm shadow-amber-100">Send segment</button>
                <button onClick={downloadLabeledJson} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 transition" disabled={labeledSegments.length === 0}>Download .JSON</button>
              </div>
              {segmentStatus && <p className="text-[10px] font-bold text-amber-600 uppercase">{segmentStatus}</p>}
            </div>
  
            <div className="flex-1 p-5 bg-slate-900 rounded-2xl text-white">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Live AI Inference</p>
              {inferenceResult?.label ? (
                <div className="space-y-1">
                  <div className={`text-3xl font-black uppercase tracking-tighter ${inferenceResult.label === 'good' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {inferenceResult.label}
                  </div>
                  <div className="text-[10px] text-slate-400 font-bold">CONFIDENCE: {(inferenceResult.confidence * 100).toFixed(0)}%</div>
                </div>
              ) : (
                <p className="text-xs italic text-slate-500">{isRecording ? 'Waiting for stable data...' : 'Awaiting recording...'}</p>
              )}
            </div>
          </div>
        </section>
  
        {/* GLOBAL FOOTER ACTIONS */}
        <div className="flex justify-center gap-4 py-6">
          <button onClick={checkBackend} className="px-4 py-2 text-[11px] font-bold text-slate-400 hover:text-slate-600 transition uppercase tracking-widest italic">Check Backend</button>
          <button onClick={saveRecord} className="px-6 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-black rounded-full hover:shadow-md transition">Save Session Record</button>
        </div>
        {backendStatus && <p className="text-center text-[10px] text-slate-400 font-bold uppercase">{backendStatus}</p>}
      </div>
    </main>
  );
}
