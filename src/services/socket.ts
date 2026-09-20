import { io, Socket } from 'socket.io-client';
import { baseUrl } from './api';

/** Connects to the backend's Socket.io telemetry feed (websocket transport). */
export function createTelemetrySocket(): Socket {
  return io(baseUrl(), {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: true,
    reconnection: true,
  });
}

export function telemetryEndpoint(): string {
  return baseUrl();
}