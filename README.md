# DryRun

Step-by-step C++ execution visualizer for competitive programmers.

Paste your C++ code, provide input, and watch your program execute — memory, stack, heap, and data structures visualized in real time.

## Structure

```
frontend/   — React + Vite + Tailwind
backend/    — FastAPI + libclang C++ interpreter
```

## Running locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
