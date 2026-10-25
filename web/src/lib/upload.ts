import type { Image } from "./types";

export interface UploadProgress {
  loaded: number;
  total: number;
}

// Match the backend's two-minute request budget, including slow file transfers.
// XHR exposes real upload progress in browsers without request-stream support.
export function uploadImage(
  file: File,
  folder?: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<Image> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const params = new URLSearchParams(folder ? { folder } : {});
    request.open("POST", `/api/images${params.size ? `?${params}` : ""}`);
    request.timeout = 120_000;
    const token = localStorage.getItem("access_token");
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        // Multipart totals include headers; report progress against file bytes.
        onProgress?.({
          loaded: Math.round((event.loaded / event.total) * file.size),
          total: file.size,
        });
      }
    };
    request.upload.onload = () =>
      onProgress?.({ loaded: file.size, total: file.size });
    request.onload = () => {
      if (request.status === 401) {
        localStorage.removeItem("access_token");
        window.location.href = "/app/login";
        reject(new Error("Your session expired. Sign in to upload photographs."));
        return;
      }
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(request.responseText) as Image);
        } catch {
          reject(new Error(
            "The server returned an invalid upload response. Refresh the library before retrying.",
          ));
        }
        return;
      }
      const message = request.status === 413
        ? "This file is too large. Choose a file smaller than 100 MB."
        : request.status === 404
          ? "The destination folder no longer exists. Choose another folder."
          : request.status === 504
            ? "The server took too long to save this file. Refresh the library before retrying."
            : `The upload failed (HTTP ${request.status}). Please try again.`;
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error(
      "The upload connection was lost. Check your connection and refresh the library before retrying.",
    ));
    request.ontimeout = () => reject(new Error(
      "The upload timed out after two minutes. Check your connection and refresh the library before retrying.",
    ));
    request.onabort = () => reject(new Error("The upload was canceled."));
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}
