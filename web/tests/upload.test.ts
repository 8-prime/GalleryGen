import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { uploadImage } from "../src/lib/upload.ts";

class UploadRequest {
  static latest: UploadRequest;
  method = "";
  url = "";
  timeout = 0;
  status = 0;
  responseText = "";
  headers = new Map<string, string>();
  body: FormData | null = null;
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
    onload: null as (() => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { UploadRequest.latest = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  send(body: FormData) { this.body = body; }
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

const globals = ["XMLHttpRequest", "localStorage", "window"] as const;
const originals = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
const storage = new Map<string, string>();
const location = { href: "" };
beforeEach(() => {
  storage.clear();
  location.href = "";
  Object.defineProperties(globalThis, {
    XMLHttpRequest: { configurable: true, value: UploadRequest },
    localStorage: { configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    } },
    window: { configurable: true, value: { location } },
  });
});
afterEach(() => {
  for (const [index, key] of globals.entries()) {
    const original = originals[index];
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("uploads send the selected folder, file and authentication with a slow-transfer budget", async () => {
  storage.set("access_token", "test-token");
  const file = new File(["photo"], "Madeira.jpg", { type: "image/jpeg" });
  const pending = uploadImage(file, "849c415e-aa91-4034-b09f-c32cfe734834");
  const request = UploadRequest.latest;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/images?folder=849c415e-aa91-4034-b09f-c32cfe734834");
  assert.equal(request.timeout, 120_000);
  assert.equal(request.headers.get("Authorization"), "Bearer test-token");
  assert.equal(request.headers.has("Content-Type"), false, "the browser supplies the multipart boundary");
  assert.equal((request.body?.get("file") as File).name, file.name);
  request.respond(201, JSON.stringify({ id: "saved", folder_id: "folder" }));
  assert.equal((await pending).id, "saved");
});

test("unfiled uploads report byte progress and wait for the save acknowledgement", async () => {
  const progress: number[] = [];
  let saved = false;
  const pending = uploadImage(new File([new Uint8Array(100)], "photo.jpg"), undefined,
    ({ loaded }) => progress.push(loaded)).then(() => { saved = true; });
  const request = UploadRequest.latest;
  assert.equal(request.url, "/api/images");
  assert.equal(request.headers.size, 0);
  request.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });
  request.upload.onprogress?.({ lengthComputable: true, loaded: 510, total: 1020 });
  request.upload.onload?.();
  await Promise.resolve();
  assert.deepEqual(progress, [50, 100]);
  assert.equal(saved, false);
  request.respond(201, JSON.stringify({ id: "saved" }));
  await pending;
  assert.equal(saved, true);
});

test("HTTP failures explain the upload problem without a folder-name warning", async () => {
  for (const [status, message] of [[413, /too large/], [404, /folder no longer exists/], [504, /too long/], [500, /HTTP 500/]] as const) {
    const pending = uploadImage(new File(["photo"], "photo.jpg"));
    UploadRequest.latest.respond(status, "error");
    await assert.rejects(pending, message);
  }
});

test("expired sessions follow the API sign-in behavior", async () => {
  storage.set("access_token", "expired");
  const pending = uploadImage(new File(["photo"], "photo.jpg"));
  UploadRequest.latest.respond(401, "");
  await assert.rejects(pending, /session expired/);
  assert.equal(storage.has("access_token"), false);
  assert.equal(location.href, "/app/login");
});

test("connection loss, timeouts, cancellation and malformed responses settle the upload", async () => {
  for (const [event, message] of [["onerror", /connection was lost/], ["ontimeout", /two minutes/], ["onabort", /canceled/]] as const) {
    const pending = uploadImage(new File(["photo"], "photo.jpg"));
    UploadRequest.latest[event]?.();
    await assert.rejects(pending, message);
  }
  const pending = uploadImage(new File(["photo"], "photo.jpg"));
  UploadRequest.latest.respond(201, "not JSON");
  await assert.rejects(pending, /invalid upload response/);
});
