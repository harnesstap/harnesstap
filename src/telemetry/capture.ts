import http from "node:http";
import https from "node:https";
import { PACKAGE_VERSION } from "../version.js";
import {
  isTelemetryEnabled,
  resolvePosthogCaptureUrl,
  resolvePosthogProjectApiKey,
} from "./config.js";
import { resolveTelemetryProduct } from "./product.js";
import { sanitizeTelemetryProps } from "./sanitize.js";
import { resolveDistinctId } from "./state.js";
import type {
  TelemetryCapturePayload,
  TelemetryEventName,
  TelemetryProps,
  TelemetryTransport,
} from "./types.js";

const CAPTURE_TIMEOUT_MS = 800;

let transportOverride: TelemetryTransport | undefined;

export function setTelemetryTransportForTests(transport?: TelemetryTransport): void {
  transportOverride = transport;
}

function unrefSocketRequest(url: string, body: string): void {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  const request = client.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      timeout: CAPTURE_TIMEOUT_MS,
    },
    (response) => {
      response.resume();
    },
  );
  request.on("error", () => undefined);
  request.on("timeout", () => {
    request.destroy();
  });
  request.on("socket", (socket) => {
    socket.unref();
  });
  request.end(body);
}

export function defaultTelemetryTransport(): TelemetryTransport {
  return {
    send(url, body) {
      unrefSocketRequest(url, body);
    },
  };
}

function transport(): TelemetryTransport {
  return transportOverride ?? defaultTelemetryTransport();
}

export function baseTelemetryProperties(): TelemetryProps {
  return {
    product: resolveTelemetryProduct(),
    app_version: PACKAGE_VERSION,
    os: process.platform,
    $lib: "harnesstap",
    $ip: null,
  };
}

export function captureEvent(
  event: TelemetryEventName,
  properties: TelemetryProps = {},
): void {
  try {
    if (!isTelemetryEnabled()) {
      return;
    }
    const apiKey = resolvePosthogProjectApiKey();
    if (!apiKey) {
      return;
    }
    const payload: TelemetryCapturePayload = {
      api_key: apiKey,
      event,
      distinct_id: resolveDistinctId(),
      properties: sanitizeTelemetryProps({
        ...baseTelemetryProperties(),
        ...properties,
      }),
    };
    transport().send(resolvePosthogCaptureUrl(), JSON.stringify(payload));
  } catch {
    // Telemetry must never throw into CLI or Desktop paths.
  }
}

export function identifyCloudUser(userId: string, anonymousDistinctId: string): void {
  try {
    if (!isTelemetryEnabled()) {
      return;
    }
    const apiKey = resolvePosthogProjectApiKey();
    if (!apiKey) {
      return;
    }
    const url = resolvePosthogCaptureUrl();
    const sender = transport();
    const identifyPayload: TelemetryCapturePayload = {
      api_key: apiKey,
      event: "$identify",
      distinct_id: userId,
      properties: sanitizeTelemetryProps({
        ...baseTelemetryProperties(),
        $anon_distinct_id: anonymousDistinctId,
      }),
    };
    sender.send(url, JSON.stringify(identifyPayload));
    const aliasPayload: TelemetryCapturePayload = {
      api_key: apiKey,
      event: "$create_alias",
      distinct_id: userId,
      properties: sanitizeTelemetryProps({
        ...baseTelemetryProperties(),
        alias: anonymousDistinctId,
      }),
    };
    sender.send(url, JSON.stringify(aliasPayload));
  } catch {
    // swallow
  }
}
