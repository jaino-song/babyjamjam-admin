# P0.3 — Deep Link Hosting Feasibility Report

## Requirements

### Android App Links
- File: `/.well-known/assetlinks.json`
- Must be hosted at: `https://<domain>/.well-known/assetlinks.json`
- Content-Type: `application/json`
- Contains: Package name + SHA-256 certificate fingerprint

### iOS Universal Links
- File: `/.well-known/apple-app-site-association`
- Must be hosted at: `https://<domain>/.well-known/apple-app-site-association`
- Content-Type: `application/json` (no file extension)
- Contains: App ID (Team ID + Bundle ID) + allowed paths

## Web Domain Analysis

### Current Setup
- The web app is a Next.js application deployed on Vercel
- Domain: Configured via environment variables (NEXT_PUBLIC_APP_URL or similar)
- The `mobile/public/` directory serves static files at the root path

### Hosting Options

#### Option A: Next.js `public/` Directory (Recommended)
- Add files to `mobile/public/.well-known/`
- Vercel automatically serves `public/` contents at root
- **Pros**: Simple, no infrastructure changes, version-controlled
- **Cons**: Requires a commit to the web app repo (minimal change)
- **Constraint check**: The plan says "no web app UI modifications" — adding `.well-known` files is infrastructure, not UI

#### Option B: Vercel Rewrites
- Add rewrite rules in `next.config.ts` to serve `.well-known` files
- **Pros**: Can serve from any source
- **Cons**: More complex, requires Next.js config change

#### Option C: CDN/DNS-Level Configuration
- Configure at Vercel project settings or DNS level
- **Pros**: No code changes
- **Cons**: Platform-dependent, harder to version control

#### Option D: Custom URL Scheme (Fallback)
- Use `imirae://` custom URL scheme instead of universal/app links
- **Pros**: No web hosting changes needed at all
- **Cons**: No web-to-app handoff, no SEO benefit, less secure (any app can register scheme)

## Decision

**Option A: Next.js `public/` directory** — Add `.well-known` files to `mobile/public/.well-known/`

### Rationale
1. Simplest implementation with minimal web repo changes
2. Version-controlled alongside the app
3. Vercel serves static files correctly with proper Content-Type
4. Adding infrastructure files is not a "UI modification" per project constraints
5. Universal/App Links provide better UX than custom URL schemes

### Fallback
If web changes are strictly blocked, use **Option D (custom URL scheme)** as fallback. This can be implemented entirely in the native apps without any web changes.

## File Templates

### `mobile/public/.well-known/assetlinks.json`
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.imirae.incheon",
      "sha256_cert_fingerprints": [
        "TODO: Add debug SHA-256 fingerprint",
        "TODO: Add release SHA-256 fingerprint"
      ]
    }
  }
]
```

### `mobile/public/.well-known/apple-app-site-association`
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TODO_TEAM_ID.com.imirae.incheon",
        "paths": [
          "/clients/*",
          "/employees/*",
          "/contracts/*",
          "/messages/templates/*",
          "/chat",
          "/chat/*"
        ]
      }
    ]
  }
}
```

## Supported Deep Link Routes

| Route Pattern | Navigation Target | Parameters |
|--------------|-------------------|------------|
| `/clients/:id` | Client Detail Screen | `clientId` |
| `/employees/:id` | Employee Detail Screen | `employeeId` |
| `/contracts/:id` | Contract Detail Screen | `contractId` |
| `/messages/templates/:id` | Template Detail Screen | `templateId` |
| `/chat` | Chat Screen | none |
| `/chat/:sessionId` | Chat Session | `sessionId` |

## Infrastructure Requirements

1. **Phase 0.4**: Register Android package name (`com.imirae.incheon`) and iOS bundle ID (`com.imirae.incheon`)
2. **Phase 0.4**: Generate SHA-256 fingerprints for Android signing keys
3. **Phase 0.4**: Get Apple Team ID from Apple Developer account
4. **Phase 1.1**: Add `.well-known` files to `mobile/public/` with actual values
5. **Phase 6.1**: Configure intent filters (Android) and Associated Domains (iOS)

## Risk Assessment

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Web repo changes blocked | Medium | Fall back to custom URL scheme (`imirae://`) |
| Vercel caching issues | Low | Set Cache-Control headers in next.config.ts |
| Certificate fingerprint mismatch | High | Test with debug + release keys; automate in CI |
| Apple AASA validation delay | Medium | Apple caches AASA files; changes take 24-48h to propagate |

## Conclusion

Deep link hosting is **feasible** with minimal web changes (2 static files in `public/.well-known/`). This is not a blocking issue. The fallback (custom URL scheme) is available if web changes are strictly prohibited.
