**BIOF3001 Final Project** | **Antonia (ltwonggg)**

## Deployment Links

* **Frontend (Vercel):** `https://assignment-ppg-heart-rate-monitor-wlttlwongs-projects.vercel.app?_vercel_share=Ayk2FCnfAci3yUwWtgF2uCPkUjK5jtI2`
* **Backend API (PythonAnywhere):** `https://ltwonggg.pythonanywhere.com/heath`

## Project Architecture
The system is built with a decoupled Full-Stack architecture:
* **Frontend:** Next.js (React) + TypeScript.
    * Visualizes real-time PPG waves using **Chart.js**.
    * Manages model and scaler uploads to the remote server.
    * Handles real-time data table rendering with custom CSS to prevent chart overlap.
* **Backend:** Flask (Python 3.13) hosted on PythonAnywhere.
    * **Signal Processing:** Implements peak detection for BPM and HRV calculation.
    * **ML Inference:** Uses `joblib` to load a **Random Forest** model and `StandardScaler` for real-time quality classification (Good vs. Bad signal).
* **Integration:** Secured via `flask-cors`. Environment variables (`FLASK_URL`) are used in the Next.js API routes to securely bridge traffic from Vercel to PythonAnywhere.

### 1. HRV Feature Extraction
The backend extracts specific features from the 100Hz signal stream:
* **Peak Detection:** Identifies systolic peaks to calculate Instantaneous Heart Rate.
* **SDNN:** Standard deviation of the NN intervals to measure heart rate variability.
* **RMSSD:** Root mean square of successive differences between peaks, used for short-term variability assessment.

### 2. Machine Learning Workflow
The system allows for a "Bring Your Own Model" workflow:
1.  User trains a model locally on PPG datasets (extracting mean, std, and HRV features).
2.  User uploads `quality_model.joblib` and `quality_scaler.joblib` via the frontend UI.
3.  The Flask backend validates the files and uses them for immediate inference on the incoming live stream.

### 3. Key Deployment Solutions
* **WSGI Path Mapping:** Manually configured `sys.path` on PythonAnywhere to resolve `ModuleNotFoundError` by pointing the server to user-installed libraries in `.local/lib/python3.13/site-packages`.
* **Dynamic Routing:** Implemented `process.env.FLASK_URL` in Next.js API routes to ensure the frontend correctly targets the production API rather than `localhost:5000`.

## Repository Structure
* `/app`: Next.js frontend pages and API routes.
* `/backend`: Flask server logic (`app.py`), model processing, and utility scripts.
* `/public`: Static assets, fonts, and icons.

## Local Development
To run this project locally:

1.  **Backend:**
    ```bash
    cd backend
    pip install flask flask-cors joblib scikit-learn
    python app.py
    ```
2.  **Frontend:**
    ```bash
    npm install
    npm run dev
    ```