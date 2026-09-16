import {
  getServiceRecordAdminHref,
  resolveDesktopFrontendOrigin,
} from "./frontend-origin";

describe("desktop frontend origin", () => {
  it("uses the canonical desktop gateway for production mobile pages", () => {
    expect(resolveDesktopFrontendOrigin({
      nodeEnv: "production",
      location: { hostname: "m.admin.babyjamjam.com" },
    })).toBe("https://admin.babyjamjam.com");
  });

  it("uses the documented desktop loopback origin in development", () => {
    expect(resolveDesktopFrontendOrigin({
      nodeEnv: "development",
      location: { hostname: "127.0.0.1", port: "3002" },
    })).toBe("http://127.0.0.1:3000");
    expect(resolveDesktopFrontendOrigin({
      nodeEnv: "development",
      location: { hostname: "localhost", port: "4310" },
    })).toBe("http://127.0.0.1:3000");
  });

  it("does not derive the desktop port from a custom mobile development port", () => {
    expect(resolveDesktopFrontendOrigin({
      nodeEnv: "development",
      location: { hostname: "127.0.0.1", port: "4310" },
    })).toBe("http://127.0.0.1:3000");
  });

  it("encodes the client id in the authenticated service-record path", () => {
    expect(getServiceRecordAdminHref(42, {
      nodeEnv: "production",
      location: { hostname: "m.admin.babyjamjam.com" },
    })).toBe("https://admin.babyjamjam.com/service-record-admin/42");
  });

  it("rejects invalid client ids before constructing a cross-app link", () => {
    expect(() => getServiceRecordAdminHref(0)).toThrow("clientId must be a positive integer");
    expect(() => getServiceRecordAdminHref(1.5)).toThrow("clientId must be a positive integer");
  });
});
