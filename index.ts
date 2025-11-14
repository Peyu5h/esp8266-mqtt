import express from "express";
import mqtt from "mqtt";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const MQTT_CONFIG = {
  host: process.env.MQTT_HOST!,
  port: parseInt(process.env.MQTT_PORT || "8883"),
  protocol: "mqtts" as const,
  username: process.env.MQTT_USERNAME!,
  password: process.env.MQTT_PASSWORD!,
  rejectUnauthorized: true,
};

const deviceId = process.env.DEVICE_ID || "esp8266_001";
const TOPICS = {
  data: `device/${deviceId}/data`,
  command: `device/${deviceId}/command`,
  status: `device/${deviceId}/status`,
};

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

console.log("### Initializing MQTT client...");
console.log(`### Connecting to: ${MQTT_CONFIG.host}:${MQTT_CONFIG.port}`);

const mqttClient = mqtt.connect(MQTT_CONFIG);

mqttClient.on("connect", () => {
  console.log("> Connected to MQTT broker");

  mqttClient.subscribe(TOPICS.data, (err) => {
    if (!err) {
      console.log(`> Subscribed to: ${TOPICS.data}`);
    } else {
      console.error("Subscription error:", err);
    }
  });

  mqttClient.subscribe(TOPICS.status, (err) => {
    if (!err) {
      console.log(`Subscribed to: ${TOPICS.status}`);
    } else {
      console.error("Subscription error:", err);
    }
  });
});

mqttClient.on("error", (error) => {
  console.error("MQTT Error:", error.message);
});

mqttClient.on("reconnect", () => {
  console.log("Reconnecting to MQTT broker...");
});

mqttClient.on("message", (topic, message) => {
  const messageStr = message.toString();
  console.log(`Received [${topic}]: ${messageStr}`);

  try {
    if (topic === TOPICS.data) {
      const parsedData = JSON.parse(messageStr);
      latestData = {
        ...parsedData,
        timestamp: new Date().toISOString(),
      };
      console.log("Data updated");
    } else if (topic === TOPICS.status) {
      console.log(`Status: ${messageStr}`);
    }
  } catch (err) {
    console.error("Parse error:", err);
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "running",
    mqtt: mqttClient.connected ? "connected" : "disconnected",
    topics: TOPICS,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/data", (req, res) => {
  res.json({
    success: true,
    data: latestData,
    mqttConnected: mqttClient.connected,
  });
});

app.post("/api/command/led", (req, res) => {
  const { state } = req.body;

  if (typeof state !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Invalid command. Expected { state: boolean }",
    });
  }

  const command = state ? "LED_ON" : "LED_OFF";
  console.log(`Command: ${command}`);

  mqttClient.publish(TOPICS.command, command, { qos: 1 }, (err) => {
    if (err) {
      console.error("Publish failed:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to send command",
      });
    }

    res.json({
      success: true,
      message: `LED turned ${state ? "ON" : "OFF"}`,
      command,
    });
  });
});

app.post("/api/command", (req, res) => {
  const { command } = req.body;

  if (typeof command !== "string" || command.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Invalid command",
    });
  }

  console.log(`Custom command: ${command}`);

  mqttClient.publish(TOPICS.command, command.trim(), { qos: 1 }, (err) => {
    if (err) {
      console.error("Publish failed:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to send command",
      });
    }

    res.json({
      success: true,
      message: "Command sent",
      command: command.trim(),
    });
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    mqtt: {
      connected: mqttClient.connected,
      topics: TOPICS,
    },
    server: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

app.listen(port, () => {
  console.log(`\n > Server running at http://localhost:${port}`);
  console.log(`### Device ID: ${deviceId}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /                  - health check`);
  console.log(`  GET  /api/data          - get device data`);
  console.log(`  GET  /api/status        - get mqtt status`);
  console.log(`  POST /api/command/led   - control led { state: boolean }`);
  console.log(`  POST /api/command       - custom command { command: string }`);
});

process.on("SIGINT", () => {
  console.log("\n Shutting down...");
  mqttClient.end();
  process.exit();
});
