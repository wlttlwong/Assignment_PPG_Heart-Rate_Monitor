import json
import os
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

from ppg_features import extract_ppg_features

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LABELED_FILE = os.path.join(SCRIPT_DIR, "labeled_records.json")
MODEL_FILE = os.path.join(SCRIPT_DIR, "quality_model.joblib")
SCALER_FILE = os.path.join(SCRIPT_DIR, "quality_scaler.joblib")


def load_labeled():
    if os.path.exists(LABELED_FILE):
        with open(LABELED_FILE, "r") as f:
            return json.load(f)
    return []

def extract_ppg_feature(ppg_data):
    sig = np.array(ppg_data)
    mean_val = np.mean(sig)
    std_val = np.std(sig)
    max_val = np.max(sig)
    min_val = np.min(sig)
    range_val = max_val - min_val
    variance = np.var(sig)
    
    # New Feature 1 - Zero Crossing Rate (for the detection of high-frequency noise)
    centered = sig - mean_val
    zcr = ((centered[:-1] * centered[1:]) < 0).sum() / len(sig)
    
    # New Feature 2 - Signal Energy (detects if finger is off camera)
    energy = np.sum(sig**2) / len(sig)
    
    # New Feature 3 - Absolute Differencing (detects sudden jumps/jitters)
    abs_diffs = np.mean(np.abs(np.diff(sig)))
    
    return [mean_val, std_val, range_val, variance, zcr, energy, abs_diffs]

def main():
    records = load_labeled()
    if len(records) < 20:
        print("Current records: {len(records)}. Goal: at least 20 for better results.")
    if len(records) < 4:
        print("Error: Need more data to train.")
        return
    
    X = np.array([extract_ppg_features(r["ppgData"]) for r in records])
    y = np.array([1 if r["label"] == "good" else 0 for r in records])
    
    if len(np.unique(y)) < 2:
        print("Error: Need both 'good' and 'bad' labels to train.")
        return
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    # 
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train_scaled, y_train)
    
    X_test_scaled = scaler.transform(X_test)
    score = model.score(X_test_scaled, y_test)
    print(f"Test accuracy: {score:.2f}")
    
    try:
        import joblib
        joblib.dump(model, MODEL_FILE)
        joblib.dump(scaler, SCALER_FILE)
        print(f"Saved model to {MODEL_FILE} and scaler to {SCALER_FILE}")
    except Exception as e:
        print("Save failed:", e)


if __name__ == "__main__":
    main()
