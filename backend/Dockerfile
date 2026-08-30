# DryRun backend — FastAPI + libclang C++ interpreter + LLM tutor.
FROM python:3.10-slim

WORKDIR /app

# The libclang pip wheel bundles the clang shared library, so no apt packages
# are needed for the interpreter. g++ is added ONLY for the /judge endpoint,
# which compiles/runs untrusted student C++ under an OS resource sandbox.
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*


COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hosts (Render/Fly/Railway) inject $PORT; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
