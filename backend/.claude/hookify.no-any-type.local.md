---
name: no-any-type
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.tsx?$
  - field: new_text
    operator: regex_match
    pattern: :\s*any\b
action: warn
---

⚠️ **TypeScript `any` Type Detected**

You are using the `any` type which bypasses TypeScript's type checking.

**Why this is flagged (per project rules):**
- `any` without a comment explaining why is forbidden
- It defeats the purpose of using TypeScript
- Bugs can slip through that types would have caught

**What to do instead:**
1. **Use a specific type:**
   ```typescript
   function process(data: UserData) { }
   ```

2. **Use `unknown` for truly unknown types:**
   ```typescript
   function handle(input: unknown) {
     if (typeof input === 'string') { }
   }
   ```

3. **Use generics for flexible types:**
   ```typescript
   function wrap<T>(value: T): Wrapper<T> { }
   ```

4. **If `any` is truly necessary, add a comment:**
   ```typescript
   // any: External library has no type definitions
   const result: any = externalLib.call();
   ```

Please either use a proper type or add a comment explaining why `any` is needed.
