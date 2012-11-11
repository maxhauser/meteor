(function () {

var path = __meteor_bootstrap__.require('path');
var Fiber = __meteor_bootstrap__.require('fibers');
var Future = __meteor_bootstrap__.require(path.join('fibers', 'future'));

Meteor._noYieldsAllowed = function (f) {
  // "Fiber" and "yield" are both in the global namespace. The yield function is
  // at both "yield" and "Fiber.yield". (It's also at require('fibers').yield
  // but that is because require('fibers') === Fiber.)
  var savedYield = Fiber.yield;
  Fiber.yield = function () {
    throw new Error("Can't call yield in a noYieldsAllowed block!");
  };
  global.yield = Fiber.yield;
  try {
    return f();
  } finally {
    Fiber.yield = savedYield;
    global.yield = savedYield;
  }
};

// js2-mode AST blows up when parsing 'future.return()', so alias.
Future.prototype.ret = Future.prototype.return;

// Meteor._SynchronousQueue is a queue which runs task functions serially.
// Tasks are assumed to be synchronous: ie, it's assumed that they are
// done when they return.
//
// It has two methods:
//   - queueTask queues a task to be run, and returns immediately.
//   - runTask queues a task to be run, and then yields. It returns
//     when the task finishes running.
//
// Somewhat inspired by async.queue, but specific to blocking tasks.
// XXX break this out into an NPM module?
// XXX could maybe use the npm 'schlock' module instead, which would
//     also support multiple concurrent "read" tasks
Meteor._SynchronousQueue = function () {
  var self = this;
  // List of tasks to run (not including a currently-running task if
  // anyway). Each is an object with field 'task' (the task function to run) and
  // 'fiber' (the Fiber associated with the blocking runTask call that queued
  // it, or null if called from queueTasks).
  self._taskHandles = [];
  // This is true if self._run() is either currently executing or scheduled to
  // do so soon.
  self._running = false;
};

_.extend(Meteor._SynchronousQueue.prototype, {
  runTask: function (task) {
    var self = this;
    self._taskHandles.push({task: task, fiber: Fiber.current});
    self._scheduleRun();
    // Yield. We'll get back here after the task is run.
    Fiber.yield();
  },
  queueTask: function (task) {
    var self = this;
    self._taskHandles.push({task: task});
    self._scheduleRun();
    // No need to block.
  },
  _scheduleRun: function () {
    var self = this;

    // Already running or scheduled? Do nothing.
    if (self._running)
      return;

    self._running = true;

    process.nextTick(function () {
      Fiber(function () {
        self._run();
      }).run();
    });
  },
  _run: function () {
    var self = this;

    if (!self._running)
      throw new Error("expected to be _running");

    if (_.isEmpty(self._taskHandles)) {
      // Done running tasks! Don't immediately schedule another run, but
      // allow future tasks to do so.
      self._running = false;
      return;
    }
    var taskHandle = self._taskHandles.shift();

    // Run the task.
    taskHandle.task();

    // Soon, run the next task, if there is any.
    self._running = false;
    self._scheduleRun();

    // If this was queued with runTask, let the runTask call return.
    if (taskHandle.fiber)
      taskHandle.fiber.run();
  }
});

})();
