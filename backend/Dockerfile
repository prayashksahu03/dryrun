# DryRun backend — FastAPI + libclang C++ interpreter + LLM tutor.
FROM python:3.10-slim

WORKDIR /app

# The libclang pip wheel bundles the clang shared library, so no apt packages
# are needed for the interpreter. g++ is added ONLY for the /judge endpoint,
# which compiles/runs untrusted student C++ under an OS resource sandbox.
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

# Precompile <bits/stdc++.h> in place so every student compile skips re-parsing
# the ~200-file header. On Render's shared CPU this turns a 10s+ compile into ~1s.
# GCC auto-uses the .gch when the compile flags match (-std=c++17 -O2), which the
# judge uses. Without this, cold compiles time out on the free tier.
RUN STDCPP=$(find /usr/include -name 'stdc++.h' | head -1) \
    && test -n "$STDCPP" \
    && g++ -std=c++17 -O2 -x c++-header "$STDCPP" -o "$STDCPP.gch" \
    && echo "PCH built at $STDCPP.gch"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hosts (Render/Fly/Railway) inject $PORT; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
