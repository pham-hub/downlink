// Site adapters (spec section 1). Each one is a file in this folder exporting
//   { name, match(candidate) -> boolean, resolve(candidates, ctx) -> Promise<SniffResult|null> }
// Adding a site means adding one file and listing it here.
module.exports = [require('./frameio')];
