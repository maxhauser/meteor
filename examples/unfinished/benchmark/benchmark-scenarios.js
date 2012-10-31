// Parameters for simulation:
//
// - numBuckets
// - numCollections
//
// - initialDocuments: Inital documents added by the server. Probably
//     not usefully combined with maxAge
//
// - maxAge: How long to leave documents in the database. This, combined
//     with all the various rates, determines the steady state database
//     size. In seconds. falsy to disable.
//
// - insertRate
// - updateRate
// - removeRate
//
// - documentSize: bytes of randomness per document.
//     // XXX make this a random distribution?
// - documentNumFields: how many fields of randomness per document.
//
// XXX also max documents?
// count and remove N?

SCENARIOS = {

  default: {
    numBuckets: 10,
    numCollections: 1,
    initialDocuments: 1,
    maxAge: 60,
    insertRate: 1,
    updateRate: 1,
    removeRate: 0.1,
    documentSize: 1024,
    documentNumFields: 8
  },

  nodata: {
    numBuckets: 1,
    numCollections: 1,
    initialDocuments: 0
  },

  bigdata: {
    numBuckets: 1,
    numCollections: 1,
    initialDocuments: 1024,
    updateRate: 1,
    documentSize: 10240,
    documentNumFields: 16
  }

};
