FROM rust:1.90.0-bookworm AS rust
FROM node:24.19.0-bookworm
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
ENV PATH=/usr/local/cargo/bin:$PATH CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup RUSTUP_TOOLCHAIN=1.90.0 \
    NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN rustup component add rustfmt clippy --toolchain 1.90.0
ARG TARGETARCH
ARG OPENCODE_VERSION=1.19.5
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lab
COPY app-lab/package*.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY app-lab/template/frontend/package*.json template/frontend/
RUN cd template/frontend && npm ci
COPY tools/rust-loop /opt/rust-loop
RUN cargo build --release --locked --manifest-path /opt/rust-loop/Cargo.toml && cp /opt/rust-loop/target/release/rust-loop /usr/local/bin/rust-loop
COPY app-lab .
RUN cargo fmt --manifest-path template/backend/Cargo.toml -- --check && cargo build --locked --manifest-path template/backend/Cargo.toml && cargo test --locked --manifest-path template/backend/Cargo.toml
RUN set -eu; arch="$TARGETARCH"; [ "$arch" != amd64 ] || arch=x64; npm install --prefix /opt/opencode --ignore-scripts "opencode-linux-${arch}@${OPENCODE_VERSION}"; ln -s "/opt/opencode/node_modules/opencode-linux-${arch}/bin/opencode" /usr/local/bin/opencode; opencode run --help > /tmp/opencode-help.txt 2>&1; grep -q -- --auto /tmp/opencode-help.txt
RUN groupadd -g 10001 worker && useradd -m -u 10001 -g 10001 worker && chmod +x docker/*.sh
USER 10001:10001
ENV HOME=/home/worker
RUN node docker/warm-provider.mjs
USER root
RUN cp -a /home/worker/.cache /opt/opencode-cache && chmod -R a+rX /opt/opencode-cache /opt/browsers
USER 10001:10001
WORKDIR /workspace
