// tsx calls os.userInfo() on Windows to name its cache directory. Some locked
// down Windows runners cannot serve that OS lookup. Supplying the Unix-style
// ID hook makes tsx use a stable cache name without weakening the test process.
if (typeof process.geteuid !== 'function') {
  process.geteuid = () => 0;
}
