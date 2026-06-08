// Wasm module declaration for static .wasm imports.
// When the @astrojs/cloudflare adapter bundles the _worker.js, wrangler's
// rollup plugin compiles .wasm files into pre-compiled WebAssembly.Module
// objects — no runtime WebAssembly.instantiate() call required.
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
