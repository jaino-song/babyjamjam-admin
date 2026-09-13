/**
 * @jest-environment node
 */
import {
  downloadAuthenticatedFile,
  fetchAuthenticatedFileBlob,
} from "./authenticated-file";

describe("authenticated file transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refreshes once before returning a protected file blob", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json(
        { code: "AUTH_REFRESH_REQUIRED" },
        { status: 401 },
      ))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("file-bytes", {
        headers: { "content-type": "application/pdf" },
      }));

    const blob = await fetchAuthenticatedFileBlob("/api/file-storage/files/42/download");

    expect(await blob.text()).toBe("file-bytes");
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/api/file-storage/files/42/download",
      "/api/auth/refresh",
      "/api/file-storage/files/42/download",
    ]);
  });

  it("downloads through a temporary object URL and revokes it", async () => {
    const anchor = { href: "", download: "", click: jest.fn(), remove: jest.fn() };
    const documentObject = {
      createElement: jest.fn().mockReturnValue(anchor),
      body: { appendChild: jest.fn() },
    };
    const urlObject = {
      createObjectURL: jest.fn().mockReturnValue("blob:protected-file"),
      revokeObjectURL: jest.fn(),
    };
    const fetchImpl = jest.fn().mockResolvedValue(new Response("file-bytes"));

    await downloadAuthenticatedFile("/api/file-storage/files/42/download", "guide.pdf", {
      documentObject: documentObject as unknown as Pick<Document, "createElement" | "body">,
      urlObject,
      fetchImpl,
    });

    expect(anchor).toMatchObject({ href: "blob:protected-file", download: "guide.pdf" });
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(urlObject.revokeObjectURL).toHaveBeenCalledWith("blob:protected-file");
  });
});
