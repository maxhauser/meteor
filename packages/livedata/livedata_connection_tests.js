var newConnection = function (stream) {
  // Some of these tests leave outstanding methods with no result yet
  // returned. This should not block us from re-running tests when sources
  // change.
  return new Meteor._LivedataConnection(stream, {reloadWithOutstanding: true});
};

var test_got_message = function (test, stream, expected) {
  if (stream.sent.length === 0) {
    test.fail({error: 'no message received', expected: expected});
    return;
  }

  var got = stream.sent.shift();

  if (typeof got === 'string' && typeof expected === 'object')
    got = JSON.parse(got);

  test.equal(got, expected);
};

var startAndConnect = function(test, stream) {
  stream.reset(); // initial connection start.

  test_got_message(test, stream, {msg: 'connect'});
  test.length(stream.sent, 0);

  stream.receive({msg: 'connected', session: SESSION_ID});
  test.length(stream.sent, 0);
};

var SESSION_ID = '17';

Tinytest.add("livedata stub - receive data", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  startAndConnect(test, stream);

  // data comes in for unknown collection.
  var coll_name = Meteor.uuid();
  stream.receive({msg: 'data', collection: coll_name, id: '1234',
                  set: {a: 1}});
  // break throught the black box and test internal state
  test.length(conn._updatesForUnknownStores[coll_name], 1);

  // XXX: Test that the old signature of passing manager directly instead of in
  // options works.
  var coll = new Meteor.Collection(coll_name, conn);

  // queue has been emptied and doc is in db.
  test.isUndefined(conn._updatesForUnknownStores[coll_name]);
  test.equal(coll.find({}).fetch(), [{_id:'1234', a:1}]);

  // second message. applied directly to the db.
  stream.receive({msg: 'data', collection: coll_name, id: '1234',
                  set: {a:2}});
  test.equal(coll.find({}).fetch(), [{_id:'1234', a:2}]);
  test.isUndefined(conn._updatesForUnknownStores[coll_name]);
});

Tinytest.addAsync("livedata stub - subscribe", function (test, onComplete) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  startAndConnect(test, stream);

  // subscribe
  var callback_fired = false;
  var sub = conn.subscribe('my_data', function () {
    callback_fired = true;
  });
  test.isFalse(callback_fired);

  test.length(stream.sent, 1);
  var message = JSON.parse(stream.sent.shift());
  var id = message.id;
  delete message.id;
  test.equal(message, {msg: 'sub', name: 'my_data', params: []});

  // get the sub satisfied. callback fires.
  stream.receive({msg: 'data', 'subs': [id]});
  test.isTrue(callback_fired);

  // This defers the actual unsub message, so we need to set a timeout
  // to observe the message. We also test that we can resubscribe even
  // before the unsub has been sent.
  //
  // Note: it would be perfectly fine for livedata_connection to send the unsub
  // synchronously, so if this test fails just because we've made that change,
  // that's OK! This is a regression test for a failure case where it *never*
  // sent the unsub if there was a quick resub afterwards.
  //
  // XXX rewrite Meteor.defer to guarantee ordered execution so we don't have to
  // use setTimeout
  sub.stop();
  conn.subscribe('my_data');

  test.length(stream.sent, 1);
  message = JSON.parse(stream.sent.shift());
  var id2 = message.id;
  test.notEqual(id, id2);
  delete message.id;
  test.equal(message, {msg: 'sub', name: 'my_data', params: []});

  setTimeout(function() {
    test.length(stream.sent, 1);
    var message = JSON.parse(stream.sent.shift());
    test.equal(message, {msg: 'unsub', id: id});
    onComplete();
  }, 10);
});


Tinytest.add("livedata stub - this", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  startAndConnect(test, stream);

  conn.methods({test_this: function() {
    test.isTrue(this.isSimulation);
    // XXX Backwards compatibility only. Remove this before 1.0.
    test.isTrue(this.is_simulation);
    this.unblock(); // should be a no-op
  }});

  // should throw no exceptions
  conn.call('test_this');

  // satisfy method, quiesce connection
  var message = JSON.parse(stream.sent.shift());
  test.equal(message, {msg: 'method', method: 'test_this',
                       params: [], id:message.id});
  test.length(stream.sent, 0);

  stream.receive({msg: 'result', id:message.id, result:null});
  stream.receive({msg: 'data', 'methods': [message.id]});

});


Tinytest.add("livedata stub - methods", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  startAndConnect(test, stream);

  var collName = Meteor.uuid();
  var coll = new Meteor.Collection(collName, {manager: conn});

  // setup method
  conn.methods({do_something: function (x) {
    coll.insert({value: x});
  }});

  // setup observers
  var counts = {added: 0, removed: 0, changed: 0, moved: 0};
  var handle = coll.find({}).observe(
    { added: function () { counts.added += 1; },
      removed: function () { counts.removed += 1; },
      changed: function () { counts.changed += 1; },
      moved: function () { counts.moved += 1; }
    });


  // call method with results callback
  var callback1Fired = false;
  conn.call('do_something', 'friday!', function (err, res) {
    test.isUndefined(err);
    test.equal(res, '1234');
    callback1Fired = true;
  });
  test.isFalse(callback1Fired);

  // observers saw the method run.
  test.equal(counts, {added: 1, removed: 0, changed: 0, moved: 0});

  // get response from server
  var message = JSON.parse(stream.sent.shift());
  test.equal(message, {msg: 'method', method: 'do_something',
                       params: ['friday!'], id:message.id});

  test.equal(coll.find({}).count(), 1);
  test.equal(coll.find({value: 'friday!'}).count(), 1);
  var docId = coll.findOne({value: 'friday!'})._id;

  // results does not yet result in callback, because data is not
  // ready.
  stream.receive({msg: 'result', id:message.id, result: "1234"});
  test.isFalse(callback1Fired);

  // result message doesn't affect data
  test.equal(coll.find({}).count(), 1);
  test.equal(coll.find({value: 'friday!'}).count(), 1);
  test.equal(counts, {added: 1, removed: 0, changed: 0, moved: 0});

  // data methods do not show up (not quiescent yet)
  stream.receive({msg: 'data', collection: collName, id: docId,
                  set: {value: 'tuesday'}});
  test.equal(coll.find({}).count(), 1);
  test.equal(coll.find({value: 'friday!'}).count(), 1);
  test.equal(counts, {added: 1, removed: 0, changed: 0, moved: 0});

  // send another methods (unknown on client)
  var callback2Fired = false;
  conn.call('do_something_else', 'monday', function (err, res) {
    callback2Fired = true;
  });
  test.isFalse(callback1Fired);
  test.isFalse(callback2Fired);

  // test we still send a method request to server
  var message2 = JSON.parse(stream.sent.shift());
  test.equal(message2, {msg: 'method', method: 'do_something_else',
                        params: ['monday'], id: message2.id});

  // get the first data satisfied message. changes are applied to database even
  // though another method is outstanding, because the other method didn't have
  // a stub. and its callback is called.
  stream.receive({msg: 'data', 'methods': [message.id]});
  test.isTrue(callback1Fired);
  test.isFalse(callback2Fired);

  test.equal(coll.find({}).count(), 1);
  test.equal(coll.find({value: 'tuesday'}).count(), 1);
  test.equal(counts, {added: 1, removed: 0, changed: 1, moved: 0});

  // second result
  stream.receive({msg: 'result', id:message2.id, result:"bupkis"});
  test.isFalse(callback2Fired);

  // get second satisfied; no new changes are applied.
  stream.receive({msg: 'data', 'methods': [message2.id]});
  test.isTrue(callback2Fired);

  test.equal(coll.find({}).count(), 1);
  test.equal(coll.find({value: 'tuesday', _id: docId}).count(), 1);
  test.equal(counts, {added: 1, removed: 0, changed: 1, moved: 0});

  handle.stop();
});

var observeCursor = function (test, cursor) {
  var counts = {added: 0, removed: 0, changed: 0, moved: 0};
  var expectedCounts = _.clone(counts);
  var handle = cursor.observe(
    { added: function () { counts.added += 1; },
      removed: function () { counts.removed += 1; },
      changed: function () { counts.changed += 1; },
      moved: function () { counts.moved += 1; }
    });
  return {
    stop: _.bind(handle.stop, handle),
    expectCallbacks: function (delta) {
      _.each(delta, function (mod, field) {
        expectedCounts[field] += mod;
      });
      test.equal(counts, expectedCounts);
    }
  };
};


// method calls another method in simulation. see not sent.
Tinytest.add("livedata stub - methods calling methods", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  startAndConnect(test, stream);

  var coll_name = Meteor.uuid();
  var coll = new Meteor.Collection(coll_name, {manager: conn});

  // setup methods
  conn.methods({
    do_something: function () {
      conn.call('do_something_else');
    },
    do_something_else: function () {
      coll.insert({a: 1});
    }
  });

  var o = observeCursor(test, coll.find());

  // call method.
  conn.call('do_something');

  // see we only send message for outer methods
  var message = JSON.parse(stream.sent.shift());
  test.equal(message, {msg: 'method', method: 'do_something',
                       params: [], id:message.id});
  test.length(stream.sent, 0);

  // but inner method runs locally.
  o.expectCallbacks({added: 1});
  test.equal(coll.find().count(), 1);
  var docId = coll.findOne()._id;
  test.equal(coll.findOne(), {_id: docId, a: 1});

  // we get the results
  stream.receive({msg: 'result', id:message.id, result:"1234"});

  // get data from the method. data from this doc does not show up yet, but data
  // from another doc does.
  stream.receive({msg: 'data', collection: coll_name, id: docId,
                  set: {value: 'tuesday'}});
  o.expectCallbacks();
  test.equal(coll.findOne(docId), {_id: docId, a: 1});
  stream.receive({msg: 'data', collection: coll_name, id: 'monkey',
                  set: {value: 'bla'}});
  o.expectCallbacks({added: 1});
  test.equal(coll.findOne(docId), {_id: docId, a: 1});
  var newDoc = coll.findOne({value: 'bla'});
  test.isTrue(newDoc);
  test.equal(newDoc, {_id: newDoc._id, value: 'bla'});

  // get method satisfied. all data shows up. the 'a' field is reverted and
  // 'value' field is set.
  stream.receive({msg: 'data', 'methods': [message.id]});
  o.expectCallbacks({changed: 1});
  test.equal(coll.findOne(docId), {_id: docId, value: 'tuesday'});
  test.equal(coll.findOne(newDoc._id), {_id: newDoc._id, value: 'bla'});

  o.stop();
});

Tinytest.add("livedata stub - reconnect", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  startAndConnect(test, stream);

  var collName = Meteor.uuid();
  var coll = new Meteor.Collection(collName, {manager: conn});

  var o = observeCursor(test, coll.find());

  // subscribe
  var subCallbackFired = false;
  var sub = conn.subscribe('my_data', function () {
    subCallbackFired = true;
  });
  test.isFalse(subCallbackFired);

  var subMessage = JSON.parse(stream.sent.shift());
  test.equal(subMessage, {msg: 'sub', name: 'my_data', params: [],
                          id: subMessage.id});

  // get some data. it shows up.
  stream.receive({msg: 'data', collection: collName,
                  id: '1234', set: {a:1}});

  test.equal(coll.find({}).count(), 1);
  o.expectCallbacks({added: 1});
  test.isFalse(subCallbackFired);

  stream.receive({msg: 'data', collection: collName,
                  id: '1234', set: {b:2},
                  subs: [subMessage.id] // satisfy sub
                 });
  test.isTrue(subCallbackFired);
  subCallbackFired = false; // re-arm for test that it doesn't fire again.

  test.equal(coll.find({a:1, b:2}).count(), 1);
  o.expectCallbacks({changed: 1});

  // call method.
  var methodCallbackFired = false;
  conn.call('do_something', function () {
    methodCallbackFired = true;
  });
  conn.apply('do_something_else', [], {wait: true});
  conn.apply('do_something_later', []);

  // XXX should test cases where methods half-finish before reset, with both
  // halves

  test.isFalse(methodCallbackFired);

  // The non-wait method should send, but not the wait method.
  var methodMessage = JSON.parse(stream.sent.shift());
  test.equal(methodMessage, {msg: 'method', method: 'do_something',
                             params: [], id:methodMessage.id});
  test.equal(stream.sent.length, 0);

  // more data. shows up immediately because there was no relevant method stub.
  stream.receive({msg: 'data', collection: collName,
                  id: '1234', set: {c:3}});
  test.equal(coll.findOne('1234'), {_id: '1234', a: 1, b: 2, c: 3});
  o.expectCallbacks({changed: 1});

  // stream reset. reconnect!  we send a connect, our pending method, and our
  // sub. The wait method still is blocked.
  stream.reset();

  test_got_message(test, stream, {msg: 'connect', session: SESSION_ID});
  test_got_message(test, stream, methodMessage);
  test_got_message(test, stream, subMessage);

  // reconnect with different session id
  stream.receive({msg: 'connected', session: SESSION_ID + 1});

  // resend data. doesn't show up: we're in reconnect quiescence.
  stream.receive({msg: 'data', collection: collName,
                  id: '1234', set: {a:1, b:2, c:3, d: 4}});
  stream.receive({msg: 'data', collection: collName,
                  id: '2345', set: {e: 5}});
  test.equal(coll.findOne('1234'), {_id: '1234', a: 1, b: 2, c: 3});
  test.isFalse(coll.findOne('2345'));
  o.expectCallbacks();

  // satisfy and return the method
  stream.receive({msg: 'data',
                  methods: [methodMessage.id]});
  test.isFalse(methodCallbackFired);
  stream.receive({msg: 'result', id:methodMessage.id, result:"bupkis"});
  // The callback still doesn't fire (and we don't send the wait method): we're
  // still in global quiescence
  test.isFalse(methodCallbackFired);
  test.equal(stream.sent.length, 0);

  // still no update.
  test.equal(coll.findOne('1234'), {_id: '1234', a: 1, b: 2, c: 3});
  test.isFalse(coll.findOne('2345'));
  o.expectCallbacks();

  // re-satisfy sub
  stream.receive({msg: 'data', subs: [subMessage.id]});

  // now the doc changes and method callback is called, and the wait method is
  // sent. the sub callback isn't re-called.
  test.isTrue(methodCallbackFired);
  test.isFalse(subCallbackFired);
  test.equal(coll.findOne('1234'), {_id: '1234', a: 1, b: 2, c: 3, d: 4});
  test.equal(coll.findOne('2345'), {_id: '2345', e: 5});
  o.expectCallbacks({added: 1, changed: 1});

  var waitMethodMessage = JSON.parse(stream.sent.shift());
  test.equal(waitMethodMessage, {msg: 'method', method: 'do_something_else',
                                 params: [], id: waitMethodMessage.id});
  test.equal(stream.sent.length, 0);
  stream.receive({msg: 'result', id: waitMethodMessage.id, result: "bupkis"});
  test.equal(stream.sent.length, 0);
  stream.receive({msg: 'data', methods: [waitMethodMessage.id]});

  // wait method done means we can send the third method
  test.equal(stream.sent.length, 1);
  var laterMethodMessage = JSON.parse(stream.sent.shift());
  test.equal(laterMethodMessage, {msg: 'method', method: 'do_something_later',
                                  params: [], id: laterMethodMessage.id});

  o.stop();
});

Tinytest.add("livedata connection - reactive userId", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);

  test.equal(conn.userId(), null);
  conn.setUserId(1337);
  test.equal(conn.userId(), 1337);
});

Tinytest.add("livedata connection - two wait methods", function (test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);
  startAndConnect(test, stream);

  // setup method
  conn.methods({do_something: function (x) {}});

  var responses = [];
  conn.apply('do_something', ['one!'], function() { responses.push('one'); });
  var one_message = JSON.parse(stream.sent.shift());
  test.equal(one_message.params, ['one!']);

  conn.apply('do_something', ['two!'], {wait: true}, function() {
    responses.push('two');
  });
  // 'two!' isn't sent yet, because it's a wait method.
  test.equal(stream.sent.length, 0);

  conn.apply('do_something', ['three!'], function() {
    responses.push('three');
  });
  conn.apply('do_something', ['four!'], function() {
    responses.push('four');
  });

  conn.apply('do_something', ['five!'], {wait: true}, function() {
    responses.push('five');
  });

  conn.apply('do_something', ['six!'], function() { responses.push('six'); });

  // Verify that we did not send any more methods since we are still waiting on
  // 'one!'.
  test.equal(stream.sent.length, 0);

  // Let "one!" finish. Both messages are required to fire the callback.
  stream.receive({msg: 'result', id: one_message.id});
  test.equal(responses, []);
  stream.receive({msg: 'data', methods: [one_message.id]});
  test.equal(responses, ['one']);

  // Now we've send out "two!".
  var two_message = JSON.parse(stream.sent.shift());
  test.equal(two_message.params, ['two!']);

  // But still haven't sent "three!".
  test.equal(stream.sent.length, 0);

  // Let "two!" finish, with its end messages in the opposite order to "one!".
  stream.receive({msg: 'data', methods: [two_message.id]});
  test.equal(responses, ['one']);
  test.equal(stream.sent.length, 0);
  stream.receive({msg: 'result', id: two_message.id});
  test.equal(responses, ['one', 'two']);

  // Verify that we just sent "three!" and "four!" now that we got
  // responses for "one!" and "two!"
  test.equal(stream.sent.length, 2);
  var three_message = JSON.parse(stream.sent.shift());
  test.equal(three_message.params, ['three!']);
  var four_message = JSON.parse(stream.sent.shift());
  test.equal(four_message.params, ['four!']);

  // Out of order response is OK for non-wait methods.
  stream.receive({msg: 'result', id: three_message.id});
  stream.receive({msg: 'result', id: four_message.id});
  stream.receive({msg: 'data', methods: [four_message.id]});
  test.equal(responses, ['one', 'two', 'four']);
  test.equal(stream.sent.length, 0);

  // Let three finish too.
  stream.receive({msg: 'data', methods: [three_message.id]});
  test.equal(responses, ['one', 'two', 'four', 'three']);

  // Verify that we just sent "five!" (the next wait method).
  test.equal(stream.sent.length, 1);
  var five_message = JSON.parse(stream.sent.shift());
  test.equal(five_message.params, ['five!']);
  test.equal(responses, ['one', 'two', 'four', 'three']);

  // Let five finish.
  stream.receive({msg: 'result', id: five_message.id});
  stream.receive({msg: 'data', methods: [five_message.id]});
  test.equal(responses, ['one', 'two', 'four', 'three', 'five']);

  var six_message = JSON.parse(stream.sent.shift());
  test.equal(six_message.params, ['six!']);
});

Tinytest.add("livedata connection - onReconnect prepends messages correctly with a wait method", function(test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);
  startAndConnect(test, stream);

  // setup method
  conn.methods({do_something: function (x) {}});

  conn.onReconnect = function() {
    conn.apply('do_something', ['reconnect zero']);
    conn.apply('do_something', ['reconnect one']);
    conn.apply('do_something', ['reconnect two'], {wait: true});
    conn.apply('do_something', ['reconnect three']);
  };

  conn.apply('do_something', ['one']);
  conn.apply('do_something', ['two'], {wait: true});
  conn.apply('do_something', ['three']);

  // reconnect
  stream.sent = [];
  stream.reset();
  test_got_message(
    test, stream, {msg: 'connect', session: conn._lastSessionId});

  // Test that we sent what we expect to send, and we're blocked on
  // what we expect to be blocked. The subsequent logic to correctly
  // read the wait flag is tested separately.
  test.equal(_.map(stream.sent, function(msg) {
    return JSON.parse(msg).params[0];
  }), ['reconnect zero', 'reconnect one']);

  // black-box test:
  test.equal(_.map(conn._outstandingMethodBlocks, function (block) {
    return [block.wait, _.map(block.methods, function (method) {
      return JSON.parse(method._message).params[0];
    })];
  }), [
    [false, ['reconnect zero', 'reconnect one']],
    [true, ['reconnect two']],
    [false, ['reconnect three', 'one']],
    [true, ['two']],
    [false, ['three']]
  ]);
});

Tinytest.add("livedata connection - onReconnect prepends messages correctly without a wait method", function(test) {
  var stream = new Meteor._StubStream();
  var conn = newConnection(stream);
  startAndConnect(test, stream);

  // setup method
  conn.methods({do_something: function (x) {}});

  conn.onReconnect = function() {
    conn.apply('do_something', ['reconnect one']);
    conn.apply('do_something', ['reconnect two']);
    conn.apply('do_something', ['reconnect three']);
  };

  conn.apply('do_something', ['one']);
  conn.apply('do_something', ['two'], {wait: true});
  conn.apply('do_something', ['three'], {wait: true});
  conn.apply('do_something', ['four']);

  // reconnect
  stream.sent = [];
  stream.reset();
  test_got_message(
    test, stream, {msg: 'connect', session: conn._lastSessionId});

  // Test that we sent what we expect to send, and we're blocked on
  // what we expect to be blocked. The subsequent logic to correctly
  // read the wait flag is tested separately.
  test.equal(_.map(stream.sent, function(msg) {
    return JSON.parse(msg).params[0];
  }), ['reconnect one', 'reconnect two', 'reconnect three', 'one']);

  // black-box test:
  test.equal(_.map(conn._outstandingMethodBlocks, function (block) {
    return [block.wait, _.map(block.methods, function (method) {
      return JSON.parse(method._message).params[0];
    })];
  }), [
    [false, ['reconnect one', 'reconnect two', 'reconnect three', 'one']],
    [true, ['two']],
    [true, ['three']],
    [false, ['four']]
  ]);
});

// XXX also test:
// - reconnect, with session resume.
// - restart on update flag
// - on_update event
// - reloading when the app changes, including session migration
