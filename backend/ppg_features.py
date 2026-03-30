import numpy as np


def extract_ppg_features(signal):
    """Extract 8 features from a PPG segment (list or array). Same as notebook."""
    arr = np.asarray(signal, dtype=float)
    if len(arr) < 2:
        return np.zeros(9)  # fallback if segment too short
    mean = np.mean(arr)
    std = np.std(arr)
    variance = np.var(arr)
    
    if std < 1e-7:
        std = 1e-7
    diff = arr - mean
    skewness = np.mean(np.power(diff, 3)) / (np.power(std, 3) + 1e-7)
    kurtosis = np.mean(np.power(diff, 4)) / (np.power(std, 4) + 1e-7)
    signal_range = np.max(arr) - np.min(arr)
    zero_crossings = np.sum(np.abs(np.diff(np.sign(diff)))) // 2
    rms = np.sqrt(np.mean(np.square(arr)))
    
    mad = np.mean(np.abs(diff))
    return np.array([
        mean, std, skewness, kurtosis,
        signal_range, zero_crossings,
        rms, variance, mad
    ], dtype=float)
