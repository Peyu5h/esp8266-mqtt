import { Hono } from "hono";
import { cors } from "hono/cors";
import mqtt from "mqtt";

const app = new Hono();
app.use("/*", cors());

interface Env {
  MQTT_HOST: string;
  MQTT_PORT: string;
  MQTT_USERNAME: string;
  MQTT_PASSWORD: string;
  DEVICE_ID: string;
}

interface DeviceData {
  ledState: boolean;
  timestamp: string;
  uptime?: number;
  freeHeap?: number;
  rssi?: number;
}

let latestData: DeviceData = {
  ledState: false,
  timestamp: new Date().toISOString(),
};

let mqttClient: any = null;

const initMqtt = (env: Env) => {
  if (mqttClient?.connected) return mqttClient;

  const url = `mqtts://${env.MQTT_HOST}:${env.MQTT_PORT}`;

  mqttClient = mqtt.connect(url, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    clean: true,
    reconnectPeriod: 5000,
  });

  const deviceId = env.DEVICE_ID || "esp8266_001";

  mqttClient.on("connect", () => {
    mqttClient.subscribe(`device/${deviceId}/data`);
    mqttClient.subscribe(`device/${deviceId}/status`);
  });

  mqttClient.on("message", (topic: string, message: Buffer) => {
    const msg = message.toString();

    if (topic === `device/${deviceId}/data`) {
      try {
        latestData = {
          ...JSON.parse(msg),
          timestamp: new Date().toISOString(),
        };
      } catch {}
    }
  });

  return mqttClient;
};

app.get("/", (c) => {
  const env = c.env as Env;
  const deviceId = env.DEVICE_ID || "esp8266_001";

  return c.json({
    status: "running",
    mqtt: mqttClient?.connected ? "connected" : "disconnected",
    topics: {
      data: `device/${deviceId}/data`,
      command: `device/${deviceId}/command`,
      status: `device/${deviceId}/status`,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/data", (c) => {
  const env = c.env as Env;
  initMqtt(env);

  return c.json({
    success: true,
    data: latestData,
    mqttConnected: mqttClient?.connected || false,
  });
});

app.post("/api/command/led", async (c) => {
  const env = c.env as Env;
  const client = initMqtt(env);
  const { state } = await c.req.json();

  if (typeof state !== "boolean") {
    return c.json({ success: false, message: "Invalid state" }, 400);
  }

  const deviceId = env.DEVICE_ID || "esp8266_001";
  const command = state ? "LED_ON" : "LED_OFF";

  client.publish(`device/${deviceId}/command`, command, { qos: 1 });

  return c.json({
    success: true,
    message: `LED turned ${state ? "ON" : "OFF"}`,
    command,
  });
});

app.post("/api/command", async (c) => {
  const env = c.env as Env;
  const client = initMqtt(env);
  const { command } = await c.req.json();

  if (!command?.trim()) {
    return c.json({ success: false, message: "Invalid command" }, 400);
  }

  const deviceId = env.DEVICE_ID || "esp8266_001";
  client.publish(`device/${deviceId}/command`, command.trim(), { qos: 1 });

  return c.json({
    success: true,
    message: "Command sent",
    command: command.trim(),
  });
});

app.get("/api/status", (c) => {
  return c.json({
    mqtt: { connected: mqttClient?.connected || false },
    server: { timestamp: new Date().toISOString() },
  });
});

export default app;
