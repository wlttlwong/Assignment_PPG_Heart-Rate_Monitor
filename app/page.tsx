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
  const { videoRef, canvasRef, isRecording, setIsRecording, error } = useCamera();
  const [samples, setSamples] = useState<number[]>([]);
  const { valleys, heartRate, hrv } = usePPGFromSamples(samples);
  const [signalCombination, setSignalCombination] = useState<SignalCombinationMode>('default');
  const signalModeRef = useRef(signalCombination);
  
  useEffect(() => {
    signalModeRef.current = signalCombination;
  }, [signalCombination]);

  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  type SegmentLabel = 'good' | 'bad';
  const [segmentLabel, setSegmentLabel] = useState<SegmentLabel>('good');
  const [segmentStatus, setSegmentStatus] = useState<string | null>(null);
  const [labeledSegments, setLabeledSegments] = useState<{ ppgData: number[]; label: string }[]>([]);

  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const scalerInputRef = useRef<HTMLInputElement>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [scalerFile, setScalerFile] = useState<File | null>(null);

  async function handleUploadModel() {
    if (!modelFile || !scalerFile) {
      setUploadStatus('Select both model and scaler files');
      return;
    }
    setUploadStatus("Uploading...");
    try {
      const toBase64 = (f: File) => new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(f);
        reader.readAsDataURL(f);
      });
      const modelBase64 = await toBase64(modelFile);
      const scalerBase64 = await toBase64(scalerFile);
      const res = await fetch('/api/upload-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelBase64, scaler: scalerBase64 })
      });
      const data = await res.json();
      setUploadStatus(res.ok && data.success ? 'Model uploaded successfully' : (data.error || 'Upload failed'));
    } catch (err) {
      setUploadStatus('Upload failed: check connection');
    }
  }

  const [inferenceResult, setInferenceResult] = useState<{
    label: string | null;
    confidence: number;
    message?: string;
  } | null>(null);

  const samplesRef = useRef<number[]>([]);
  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  // FIX: Explicitly stop camera hardware and toggle state
  const handleToggleRecording = async () => {
    if (isRecording) {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) videoRef.current.srcObject = stream;
        setIsRecording(true);
      } catch (err) {
        console.error("Camera access denied", err);
      }
    }
  };

  // Inference Logic
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
        if (!cancelled) setInferenceResult({ label: null, confidence: 0, message: 'Request failed' });
      }
    }
    const id = setInterval(run, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [isRecording]);

  // Throttled Canvas Processing
  useEffect(() => {
    const video = videoRef.current;
    const c = canvasRef.current;
    if (!isRecording || !video || !c) return;
  
    const ctx = c.getContext('2d');
    if (!ctx) return;
  
    let animationFrameId: number;
    let lastUpdateTime = 0;
    const targetFps = 30;
    const msPerFrame = 1000 / targetFps;
  
    function tick(timestamp: number) {
      if (!isRecording) return;
      const v = videoRef.current;
      const canvas = canvasRef.current;
  
      if (!v?.srcObject || v.readyState < 2 || !canvas) {
        animationFrameId = requestAnimationFrame(tick);
        return;
      }
  
      if (timestamp - lastUpdateTime >= msPerFrame) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx!.drawImage(v, 0, 0);
  
        const w = 10, h = 10;
        const x = (canvas.width - w) / 2;
        const y = (canvas.height - h) / 2;
        const data = ctx!.getImageData(x, y, w, h).data;
        
        let rSum = 0, gSum = 0, bSum = 0, pixelCount = 0;
        for (let i = 0; i < data.length; i += 4) {
          rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
          pixelCount += 1;
        }

        const ppgValue = computePPGFromRGB(rSum, gSum, bSum, pixelCount, signalModeRef.current);
        setSamples((prev) => [...prev.slice(-(SAMPLES_TO_KEEP - 1)), ppgValue]);
        lastUpdateTime = timestamp;
      }
      animationFrameId = requestAnimationFrame(tick);
    }
  
    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isRecording]);

  // API Handlers
  async function checkBackend() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setBackendStatus(data.ok ? 'Backend OK' : 'Backend returned unexpected data');
    } catch { setBackendStatus('Backend unreachable'); }
  }

  async function sendLabeledSegment() {
    if (samples.length < MIN_SAMPLES_FOR_DETECTION) {
      setSegmentStatus('Need more samples (start recording first)');
      return;
    }
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
      }
    } catch { setSegmentStatus('Error: request failed'); }
  }

  async function saveRecord() {
    const record = {
      heartRate: { bpm: heartRate.bpm, confidence: heartRate.confidence },
      hrv: { sdnn: hrv?.sdnn ?? 0, confidence: hrv?.confidence ?? 0 },
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
      setSaveStatus(data.success ? 'Saved' : 'Error saving');
    } catch { setSaveStatus('Error: request failed'); }
  }

  function downloadLabeledJson() {
    const blob = new Blob([JSON.stringify(labeledSegments, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'labeled_records.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-12 px-4 font-sans text-slate-700">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="text-center space-y-4 mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 text-rose-500 text-xl">❤️</div>
          <h1 className="text-3xl font-bold text-slate-900">PPG Heart-Rate Monitor</h1>
          <p className="text-slate-500 max-w-xl mx-auto text-sm">
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
            {isRecording && (
              <div className="relative w-full max-w-md aspect-video bg-black rounded-2xl overflow-hidden shadow-inner">
                <video ref={videoRef} autoPlay muted playsInline className="hidden" />
                <canvas ref={canvasRef} className="w-full h-full object-contain" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border-2 border-red-500 pointer-events-none" />
              </div>
            )}
            
            <button
              onClick={handleToggleRecording}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md ${
                isRecording ? 'bg-[#065F46] text-white' : 'bg-[#10B981] text-white hover:bg-[#059669]'
              }`}
            >
              {isRecording ? 'Stop recording' : 'Start recording'}
            </button>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          </div>
        </section>
  
        {/* 3. SIGNALS & METRICS SECTION */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-[#3B82F6]" />
            <h2 className="text-sm font-bold text-slate-800 tracking-wider">Signal & Metrics</h2>
          </div>

          <div className="space-y-6">
            {/* Signal combination selector */}
            <div className='max-w-md'>
            <SignalCombinationSelector value={signalCombination} onChange={setSignalCombination} />
            </div>

            {/* PPG Signal Chart */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="h-full w-full pb-8">
                <ChartComponent ppgData={samples} valleys={valleys} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Heart Rate</p>
                <p className="text-xl font-bold text-slate-900">
                  {heartRate.bpm > 0 ? `${heartRate.bpm} bpm` : '--'}
                </p>
              </div>

              <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Confidence</p>
                <p className="text-xl font-bold text-slate-900">
                  {heartRate.confidence > 0 ? `${heartRate.confidence.toFixed(0)}%` : '--'}
                </p>
              </div>

              <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">HRV</p>
                <p className="text-xl font-bold text-slate-900">
                  {hrv.sdnn > 0 ? `${hrv.sdnn.toFixed(0)} ms` : '--'}
                </p>
              </div>

              <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Quality</p>
                  <p className={`text-xl font-bold ${
                    inferenceResult?.label === 'good' ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {inferenceResult?.label
                      ? `${inferenceResult.label} (${(inferenceResult.confidence * 100).toFixed(0)}%)`
                      : 'Collecting'}
                  </p>
              </div>
            </div>
          </div>
        </section>

        {/* 4. UPLOAD MODEL SECTION */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex flex-col gap-1 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#6366F1]" />
              <h2 className="text-sm font-bold text-slate-800 tracking-wider">Upload trained model</h2>
            </div>
            <p className="text-[11px] text-slate-400 font-medium ml-4 leading-relaxed">
              After training locally (run train_quality_model.py on downloaded JSON), select each file, then click Upload.
            </p>
          </div>

          <div className="space-y-3 ml-4">
            <input type="file" ref={modelInputRef} className="hidden" onChange={(e) => setModelFile(e.target.files?.[0] || null)} />
            <input type="file" ref={scalerInputRef} className="hidden" onChange={(e) => setScalerFile(e.target.files?.[0] || null)} />

            <div className="flex items-center gap-3">
              <button
                onClick={() => modelInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition shadow-sm"
              >
                <span className="text-[14px]">📄</span>
                <span className="text-xs font-bold text-slate-700">Model file</span>
              </button>
              <span className="text-[11px] text-slate-400 font-medium">
                {modelFile ? modelFile.name : "Not selected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => scalerInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition shadow-sm"
              >
                <span className="text-[14px]">📄</span>
                <span className="text-xs font-bold text-slate-700">Scaler file</span>
              </button>
              <span className="text-[11px] text-slate-400 font-medium">
                {scalerFile ? scalerFile.name : "Not selected"}
              </span>
            </div>

            <div className="flex items-center gap-4 pt-4">
              <button
                onClick={handleUploadModel}
                disabled={!modelFile || !scalerFile}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
                  modelFile && scalerFile
                  ? 'bg-[#6366F1] text-white hover:bg-[#4F46E5] active:scale-95'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <span>📤</span> Upload model
              </button>
              {uploadStatus && (
                <span className={`text-xs font-bold ${
                  uploadStatus.includes('successfully') ? 'text-emerald-500' : 'text-rose-500'
                }`}>
                  {uploadStatus}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* 5. ML SECTION */}
        <section className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
              <h2 className="text-sm font-bold text-slate-800 tracking-wider">Collect Labeled Data</h2>
            </div>
            <p className="text-[11px] text-slate-400 font-medium ml-4">
              Choose a label, watch the signal until it matches, then send. Data is stored in the browser. Download when ready to train.
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={segmentLabel === 'good'} onChange={() => setSegmentLabel('good')} className="accent-[#10B981]" /> Good</label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={segmentLabel === 'bad'} onChange={() => setSegmentLabel('bad')} className="accent-rose-500" /> Bad</label>
            </div>

            {/* Label Counter*/}
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-tight">
              Good: {labeledSegments.filter(s => s.label === 'good').length} |
              Bad: {labeledSegments.filter(s => s.label === 'bad').length} |
              Total: {labeledSegments.length}
            </div>

            <div className="flex gap-4">
              <button onClick={sendLabeledSegment} className="px-5 py-2 bg-[#F59E0B] text-white text-xs font-bold rounded-xl">Send Segment</button>
              <button onClick={downloadLabeledJson} className="px-5 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl" disabled={labeledSegments.length === 0}>Download JSON</button>

              {segmentStatus && segmentStatus.includes('Saved') && (
                <span className="text-sm font-bold text-[#76C19D] ml-2">
                  {segmentStatus}
                </span>
              )}
            </div>
          </div>
        </section>

        <footer className="flex justify-center gap-4 pt-4 border-t border-slate-100">
          <button onClick={checkBackend} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest italic">Check Backend Status</button>
          <button onClick={saveRecord} className="px-6 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-black rounded-full shadow-sm">Save Session</button>
        </footer>
      </div>
    </main>
  );
}
