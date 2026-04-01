import base64
import io
import json
import os
from datetime import datetime

import numpy as np
import joblib 
from flask import Flask, request, jsonify
from flask_cors import CORS

from ppg_features import extract_ppg_features

app = Flask(__name__)
CORS(app)

QUALITY_MODEL = None
QUALITY_SCALER = None

BASE_DIR = os.path.dirname(__file__)
model_path = os.path.join(BASE_DIR, "quality_model.joblib")
scaler_path = os.path.join(BASE_DIR, "quality_scaler.joblib")

# Modified to accept force_reload so the upload route can refresh the model
def load_quality_model(force_reload=False):
    global QUALITY_MODEL, QUALITY_SCALER
    
    # If already loaded and not forcing a reload, just return
    if not force_reload and QUALITY_MODEL is not None:
        return
        
    try:
        if os.path.exists(model_path) and os.path.exists(scaler_path):
            QUALITY_MODEL = joblib.load(model_path)
            QUALITY_SCALER = joblib.load(scaler_path)
            print("Successfully loaded quality model and scaler.")
        else:
            print("Model files not found. Please train and upload.")
    except Exception as e:
        print(f"Error loading model/scaler: {e}")

DATA_FILE = os.path.join(os.path.dirname(__file__), "records.json")
LABELED_FILE = os.path.join(os.path.dirname(__file__), "labeled_records.json")


def load_records():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    return []


def save_records(records):
    with open(DATA_FILE, "w") as f:
        json.dump(records, f, indent=2)


def load_labeled():
    if os.path.exists(LABELED_FILE):
        with open(LABELED_FILE, "r") as f:
            return json.load(f)
    return []


def save_labeled(records):
    with open(LABELED_FILE, "w") as f:
        json.dump(records, f, indent=2)

@app.route('/upload-model', methods=['POST'])
def upload_model():
    global QUALITY_MODEL, QUALITY_SCALER
    try:
        body = request.get_json()
        if not body or "model" not in body or "scaler" not in body:
            return jsonify({"success": False, "error": "Missing model or scaler in request"}), 400
        
        # Decode the base64 strings
        model_bytes = base64.b64decode(body["model"])
        scaler_bytes = base64.b64decode(body["scaler"])
        
        # Write the new files to disk
        with open(model_path, "wb") as f:
            f.write(model_bytes)
        with open(scaler_path, "wb") as f:
            f.write(scaler_bytes)
        
        # Force the global variables to update with the new files
        load_quality_model(force_reload=True)
        
        return jsonify({"success": True, "message": "Model and scaler uploaded successfully."}), 200
    except Exception as e:
        print(f"Upload Route Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"ok": True})


@app.route('/save-record', methods=['POST'])
def save_record():
    try:
        body = request.get_json()
        if not body:
            return jsonify({"success": False, "error": "No body"}), 400
        records = load_records()
        record = {
            "heartRate": body.get("heartRate", {}),
            "hrv": body.get("hrv", {}),
            "ppgData": body.get("ppgData", []),
            "timestamp": body.get("timestamp") or datetime.utcnow().isoformat(),
        }
        records.append(record)
        save_records(records)
        return jsonify({"success": True, "data": record}), 201
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route('/save-labeled-segment', methods=['POST'])
def save_labeled_segment():
    try:
        body = request.get_json()
        if not body:
            return jsonify({"success": False, "error": "No body"}), 400
        ppg_data = body.get("ppgData", [])
        label = body.get("label")
        if not isinstance(ppg_data, list) or label not in ("good", "bad"):
            return jsonify(
                {"success": False, "error": "Need ppgData (array) and label (good/bad)"}
            ), 400
        records = load_labeled()
        records.append({
            "ppgData": ppg_data,
            "label": label,
            "timestamp": datetime.utcnow().isoformat(),
        })
        save_labeled(records)
        return jsonify({"success": True}), 201
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route('/infer-quality', methods=['POST'])
def infer_quality():
    try:
        body = request.get_json()
        if not body or not body.get("ppgData"):
            return jsonify({"error": "Missing ppgData"}), 400
        ppg_data = body["ppgData"]
        
        # Ensure model is loaded (if not already)
        load_quality_model()
        
        if QUALITY_MODEL is None or QUALITY_SCALER is None:
            return jsonify({
                "label": None,
                "confidence": 0,
                "message": "No model loaded. Please upload model and scaler files.",
            }), 200
            
        # Extract features and predict
        features = np.array(extract_ppg_features(ppg_data)).reshape(1, -1)
        X_scaled = QUALITY_SCALER.transform(features)
        
        pred = QUALITY_MODEL.predict(X_scaled)[0]
        proba = QUALITY_MODEL.predict_proba(X_scaled)[0]
        
        label = "good" if pred == 1 else "bad"
        confidence = float(max(proba))
        
        return jsonify({"label": label, "confidence": round(confidence, 2)})
    except Exception as e:
        print(f"Inference Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Initial load on startup
    load_quality_model()
    # Running on 5000 - Ensure your Next.js route.ts matches this!
    app.run(debug=True, port=5000)