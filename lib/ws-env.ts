// `ws` calls the optional native `bufferutil` once a frame is 48 bytes or larger.
// Next bundles that missing addon as an empty module, so `mask` is not a function
// and the spoken wav never reaches 智聆. Force the pure-JS mask before `ws` loads.
process.env.WS_NO_BUFFER_UTIL ??= "1";
