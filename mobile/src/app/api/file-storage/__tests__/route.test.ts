/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as downloadFile } from "../files/[fileId]/download/route";
import {
  DELETE as deleteFile,
  GET as getFile,
  PUT as updateFile,
} from "../files/[fileId]/route";
import { GET as listFiles, POST as uploadFile } from "../files/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createJsonRequest(path: string, method: string, body: BodyInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body,
  });
}

function createGetRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: "auth_token=auth-token" },
  });
}

function createUploadRequest(): NextRequest {
  const formData = new FormData();
  formData.append("file", new File(["contents"], "document.txt", { type: "text/plain" }));
  formData.append("name", "Document");

  return new NextRequest("http://localhost/api/file-storage/files", {
    method: "POST",
    headers: { cookie: "auth_token=auth-token" },
    body: formData,
  });
}

describe("file-storage API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and payload when listing files", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "document access denied" },
      },
    });

    const response = await listFiles(createGetRequest("/api/file-storage/files"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "document access denied" });
  });

  it("preserves backend status and payload when uploading files", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await uploadFile(createUploadRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });

  it("rejects unsafe file detail IDs before proxying", async () => {
    const response = await getFile(
      createGetRequest("/api/file-storage/files/bad%2Fid"),
      { params: Promise.resolve({ fileId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid file id" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateFile(
      createJsonRequest("/api/file-storage/files/file_123", "PUT", "{bad-json"),
      { params: Promise.resolve({ fileId: "file_123" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("preserves backend delete error status and payload", async () => {
    mockDelete.mockRejectedValue({
      response: {
        status: 409,
        data: { error: "document is locked" },
      },
    });

    const response = await deleteFile(
      createGetRequest("/api/file-storage/files/file_123"),
      { params: Promise.resolve({ fileId: "file_123" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "document is locked" });
  });

  it("rejects unsafe download IDs before proxying", async () => {
    const response = await downloadFile(
      createGetRequest("/api/file-storage/files/bad%2Fid/download"),
      { params: Promise.resolve({ fileId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid file id" });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
