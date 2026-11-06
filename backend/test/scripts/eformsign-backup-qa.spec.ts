import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Native ESM import in a separate inert Node process: ordinary Jest never opens private inputs.
const moduleUrl = pathToFileURL(path.resolve(__dirname, "../../scripts/eformsign-backup-qa.mjs")).href;
function probe(source: string) {
    const result = spawnSync(process.execPath, ["--input-type=module"], {
        input: `import * as qa from ${JSON.stringify(moduleUrl)};\n${source}`,
        env: { PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    return result.stdout.trim();
}
const argsSource = "['self-test','--connection-file',qa.TARGET.connection,'--qa-env-file',qa.TARGET.qaEnv,'--root',qa.TARGET.root]";
describe("backup QA strict CLI (hermetic)", () => {
    it("imports without executing or reading private configuration", () => {
        expect(probe("console.log('inert');")).toBe("inert");
    });
    it("pins unchanged classifier, export constants and status source bytes", () => {
        expect(probe(`const fs=await import('node:fs/promises');const crypto=await import('node:crypto');const base=${JSON.stringify(path.resolve(__dirname, "../.."))};let n=0;for(const [file,expected] of Object.entries(qa.POLICY_ARTIFACTS)){const bytes=await fs.readFile(base+'/'+file);if(crypto.createHash('sha256').update(bytes).digest('hex')===expected)n++;}console.log(Object.isFrozen(qa.POLICY_ARTIFACTS),n,Object.keys(qa.POLICY_ARTIFACTS).length);`)).toBe("true 4 4");
    });
    it("allows a credential-free client-probe with only an optional full candidate", () => {
        expect(probe("console.log(qa.parseArgs(['client-probe']).mode);let n=0;for(const flags of [['--root',qa.TARGET.root],['--qa-env-file',qa.TARGET.qaEnv],['--connection-file',qa.TARGET.connection],['--profile','basic'],['--candidate','short'],['--candidate','a'.repeat(40),'--candidate','a'.repeat(40)]]){try{qa.parseArgs(['client-probe',...flags])}catch{n++}}console.log(n);" )).toBe("client-probe\n6");
    });
    it("preserves every datasource/model/other-generator byte when deriving the private schema", () => {
        const prefix = 'generator client {\n  provider = "prisma-client-js"\n}\n';
        const suffix = '\ndatasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\nmodel sample {\n  id String @id\n}\ngenerator another {\n  provider = "untouched"\n}\n';
        expect(probe(`const prefix=${JSON.stringify(prefix)},suffix=${JSON.stringify(suffix)};const derived=qa.deriveGenerationSchema(prefix+suffix,'/node','/generator.js');console.log(derived.endsWith(suffix),derived.startsWith('generator client {\\n  provider = \"/node /generator.js\"\\n  output = \"../generated\"\\n}\\n'));let n=0;for(const source of [prefix.replace('client','other')+suffix,(prefix+suffix).replace('prisma-client-js','unsupported'),prefix+prefix+suffix]){try{qa.deriveGenerationSchema(source,'/node','/generator.js')}catch{n++}}console.log(n);`)).toBe("true true\n3");
    });
    it("binds formatted schema tokens without ignoring quoted defaults or model changes", () => {
        expect(probe(`const source='model x { id String @id value String @default("a b") }';const tokens=JSON.stringify(qa.schemaTokens(source));console.log(tokens===JSON.stringify(qa.schemaTokens(source.replaceAll(' ', '  ' ).replace('a  b','a b'))),tokens!==JSON.stringify(qa.schemaTokens(source.replace('a b','ab'))),tokens!==JSON.stringify(qa.schemaTokens(source.replace('String','Int'))));`)).toBe("true true true");
    });
    it("preserves all block attributes while permitting only their contiguous ordering", () => {
        const schema = "model x {\n id String @id\n @@index([id])\n @@unique([id])\n}";
        expect(probe(`const a=${JSON.stringify(schema)};const b=a.split(String.fromCharCode(10));[b[2],b[3]]=[b[3],b[2]];const other=b.join(String.fromCharCode(10));const identity=JSON.stringify(qa.schemaTokens(a));console.log(identity===JSON.stringify(qa.schemaTokens(other)),identity!==JSON.stringify(qa.schemaTokens(other.replace('@@unique','@@index'))));`)).toBe("true true");
    });
    it("accepts absent or null env keys and records their exact own-property presence", () => {
        expect(probe(`for(const body of [{},{rootEnvPath:null},{schemaEnvPath:null},{schemaEnvPath:null,rootEnvPath:null}]){const result=qa.inspectEnvMetadata('"relativeEnvPaths": '+JSON.stringify(body));console.log(result.rootEnvPath===null && result.schemaEnvPath===null,JSON.stringify(result.ownKeys));}`)).toBe([
            'true {"rootEnvPath":false,"schemaEnvPath":false}',
            'true {"rootEnvPath":true,"schemaEnvPath":false}',
            'true {"rootEnvPath":false,"schemaEnvPath":true}',
            'true {"rootEnvPath":true,"schemaEnvPath":true}',
        ].join("\n"));
    });
    it("rejects missing, invalid, non-null, unknown and duplicate metadata before executing code", () => {
        expect(probe(`const bad=['','"relativeEnvPaths": null','"relativeEnvPaths": []','"relativeEnvPaths": false','"relativeEnvPaths": 0','"relativeEnvPaths": ""','"relativeEnvPaths": {} || process.env.CANARY','"relativeEnvPaths": {} + {}','"relativeEnvPaths": {} "relativeEnvPaths": null','"relativeEnvPaths": {"otherEnvPath": null}','"relativeEnvPaths": {"rootEnvPath": null,"rootEnvPath": null}','"relativeEnvPaths": {"rootEnvPath": process.env.CANARY}','"relativeEnvPaths": {"rootEnvPath": null,}'];for(const key of ['rootEnvPath','schemaEnvPath']){for(const value of ['', '../../../backend/.env',0,1,true,false,{},[],{nested:null}])bad.push('"relativeEnvPaths": '+JSON.stringify({[key]:value}));bad.push('"relativeEnvPaths": {'+JSON.stringify(key)+': undefined}');}let n=0;for(const source of bad){try{qa.inspectEnvMetadata(source)}catch(error){if(error.message==='GENERATED_ENV_METADATA_REFUSED')n++}}console.log(n,bad.length);`)).toBe("33 33");
    });
    it("rejects original package, original generated and subpath modules already in cache", () => {
        expect(probe("const original='/p/client/default.js',directory='/p/client',generated=['/g/.prisma/client'];qa.assertOriginalAbsent({},original,directory,generated);let n=0;for(const file of [original,'/p/client/index.js','/p/client/runtime/library.js','/g/.prisma/client/default.js','/other/.prisma/client/index.js']){try{qa.assertOriginalAbsent({[file]:{}},original,directory,generated)}catch{n++}}console.log(n);" )).toBe("5");
    });
    it("rejects arbitrary manifest locations before reading them", () => {
        expect(probe("let n=0;for(const file of ['/tmp/manifest.json','relative/manifest.json',qa.TARGET.root+'/client-runtime/../manifest.json',qa.TARGET.root+'/client-runtime/wrong.json']){try{await qa.validatePrivateManifest(file,'a'.repeat(64))}catch{n++}}console.log(n);" )).toBe("4");
    });
    it("detects added, deleted and changed environment values without printing any value", () => {
        expect(probe("const snapshot=qa.environmentSnapshot();let n=0;process.env.CANARY_PRIVATE='never-print';try{qa.assertEnvironment(snapshot)}catch{n++}delete process.env.CANARY_PRIVATE;qa.assertEnvironment(snapshot);process.env.PATH='changed';try{qa.assertEnvironment(snapshot)}catch{n++}delete process.env.PATH;try{qa.assertEnvironment(snapshot)}catch{n++}console.log(n);" )).toBe("3");
    });
    it("accepts only exact paths and known single flags", () => {
        expect(probe(`const args=${argsSource}; console.log(qa.parseArgs(args).profile);`)).toBe("basic");
        expect(probe(`const args=${argsSource}; let n=0; const variants=[['bogus',...args.slice(1)],[...args,'--profile','basic','--profile','kst'],[...args,'--extra','x'],[...args,'--port','3001'],[...args,'--candidate','abc'],[...args,'--port'],[...args,'--root','relative']]; for(const a of variants){try{qa.parseArgs(a)}catch{n++}} console.log(n);`)).toBe("7");
    });
    it("rejects relative, traversal, other-worktree and repeated credential paths", () => {
        expect(probe(`const args=${argsSource}; let n=0; for(const value of ['relative','/tmp/connection.json',qa.TARGET.connection.replace('/private-ui-postgres-synced/','/private-ui-postgres-synced/../private-ui-postgres-synced/'),qa.TARGET.connection+'\u0000']){const a=[...args];a[2]=value;try{qa.parseArgs(a)}catch{n++}} console.log(n);`)).toBe("4");
    });
    it("checks the entire descriptor before any password read", () => {
        expect(probe(`const d={host:qa.TARGET.host,port:qa.TARGET.port,user:qa.TARGET.user,database:qa.TARGET.database,passwordFile:qa.TARGET.password};const o={host:d.host,port:d.port,database:d.database,createdByThisTask:true};qa.validateDescriptor(d,o);let n=0;for(const change of [{host:'remote'},{port:63237},{database:'backup_exec_throwaway_other'},{user:'postgres'},{passwordFile:'/tmp/p'},{extra:true}]){try{qa.validateDescriptor({...d,...change},o)}catch{n++}}try{qa.validateDescriptor(d,{...o,createdByThisTask:false})}catch{n++}console.log(n);`)).toBe("7");
    });
    it("never inherits database, service, loader or credential environment", () => {
        expect(probe("process.env.DATABASE_URL='CANARY_DB';process.env.VALKEY_URL='CANARY_VALKEY';process.env.NODE_OPTIONS='CANARY_LOADER';process.env.LOCAL_AUTO_LOGIN_PASSWORD='CANARY_SECRET';const env=qa.cleanEnv();console.log(JSON.stringify(Object.keys(env).sort()));")).toBe('["LANG","PATH"]');
    });
    it("preserves DDL differences while stripping only permitted dump noise", () => {
        expect(probe("const a='-- Dumped by pg_dump version 17.1\\n\\\\restrict A123\\nCREATE TABLE x (id int);\\n\\\\unrestrict A123\\n';const b=a.replaceAll('A123','B456').replace('17.1','17.2');console.log(qa.normalizeDump(a)===qa.normalizeDump(b),qa.normalizeDump(a)!==qa.normalizeDump(a.replace('id int','id bigint')));" )).toBe("true true");
    });
    it("refuses symlinks and nonprivate files without reading contents", () => {
        expect(probe("const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'backup-qa-hermetic-'));await fs.chmod(dir,0o700);try{const file=path.join(dir,'f');await fs.writeFile(file,'secret-canary',{mode:0o600});await qa.physical(file,'file');await fs.symlink(file,path.join(dir,'s'));let n=0;try{await qa.physical(path.join(dir,'s'),'file')}catch{n++}await fs.chmod(file,0o644);try{await qa.physical(file,'file')}catch{n++}console.log(n);}finally{await fs.rm(dir,{recursive:true,force:true})}" )).toBe("2");
    });
    it("refuses foreign process identity even with a reused PID", () => {
        expect(probe("try{qa.verifyProcess({uid:process.getuid(),pid:process.pid,entry:'/wrong',root:qa.TARGET.root},{identity:'same',cwd:'/wrong'},{identity:'same',cwd:'/wrong'});console.log('unsafe')}catch{console.log('refused')}" )).toBe("refused");
    });
    it("rejects foreign, interrupted and incompatible preparation markers without convergence", () => {
        expect(probe("const sources={schema:'s',migration:'m',verification:'v'};const marker={version:5,phase:'prepared',ownerNonce:'10000000-0000-4000-8000-000000000001',history:[],sources,fingerprint:'a'.repeat(64)};qa.validatePreparedMarker(marker,sources);let n=0;for(const change of [{version:4},{phase:'preparing'},{phase:'schema-pushed'},{phase:'session'},{ownerNonce:'foreign'},{sources:{...sources,schema:'changed'}},{fingerprint:'bad'}]){try{qa.validatePreparedMarker({...marker,...change},sources)}catch{n++}}console.log(n);" )).toBe("7");
    });
    it("survives a real child disconnect racing its stop message (EPIPE regression)", () => {
        expect(probe("const {spawn}=await import('node:child_process');for(let n=0;n<5;n++){const child=spawn(process.execPath,['-e',\"process.send('failed');process.disconnect()\"],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','ignore','ignore','ipc']});child.on('message',()=>qa.safeChildSend(child,'stop'));await new Promise(resolve=>child.once('exit',resolve));qa.safeChildSend(child,'stop');}console.log('closed-without-raw-error');" )).toBe("closed-without-raw-error");
    });
});

describe("V5 native-only scope and safe diagnostics", () => {
    it("pins the new target and exact 79 table names", () => {
        expect(probe("console.log(qa.TARGET.database,qa.TARGET.connection.endsWith('/private-ui-postgres-synced/connection.json'),qa.TARGET.root.endsWith('/qa-fixture-synced-runtime'),qa.TABLE_INVENTORY.length,new Set(qa.TABLE_INVENTORY).size,qa.TABLE_INVENTORY.includes('admin_audit_event'));" )).toBe("backup_exec_throwaway_ui_synced_20261107 true true 79 79 true");
    });
    it("accepts exactly the 27 owned paths and rejects foreign changes, renames and deletions", () => {
        expect(probe("for(const path of qa.NATIVE_OWNED_PATHS)qa.validateNativeChanges([{path,status:' M'}]);let n=0;for(const path of ['backend/test/qa/eformsign-backup-fixture-data.ts','backend/prisma/schema.prisma','backend/.env','package.json','pnpm-lock.yaml','backend/infrastructure/auth/jwt.guard.ts','unknown']){try{qa.validateNativeChanges([{path,status:' M'}])}catch{n++}}for(const status of ['R ',' R','C ',' D','D ','UU']){try{qa.validateNativeChanges([{path:qa.NATIVE_OWNED_PATHS[0],status}])}catch{n++}}console.log(Object.isFrozen(qa.NATIVE_OWNED_PATHS),qa.NATIVE_OWNED_PATHS.length,new Set(qa.NATIVE_OWNED_PATHS).size,n);" )).toBe("true 27 27 13");
    });
    it("validates each phase field independently and never reflects an unknown error", () => {
        expect(probe("console.log(JSON.stringify(qa.safeNativePhase({phaseStage:'basic',phaseStep:'consume',phaseFailure:'PRODUCT_BRANCH_ORACLE'})));console.log(JSON.stringify(qa.safeNativePhase({phaseStage:'secret-path',phaseStep:'secret-token',phaseFailure:'PRODUCT_BRANCH_ORACLE secret'})));" )).toBe('{"phaseStage":"basic","phaseStep":"consume","phaseFailure":"PRODUCT_BRANCH_ORACLE"}\n{"phaseStage":"routeprobe","phaseStep":"routeprobe","phaseFailure":"NATIVE_PHASE_FAILED"}');
    });
});
