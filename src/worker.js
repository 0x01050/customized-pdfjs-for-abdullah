/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

function Message(data) {
  this.data = data;
  this.allowsReply = false;
  this.messager;
  this.id;
}
Message.prototype = {
  reply: function messageReply(data) {
    if (!this.allowsReply)
      error('This message does not accept replies.');

    this.messager({
      isReply: true,
      callbackId: this.id,
      data: data
    });
  },
  setupReply: function setupReply(messager, id) {
    this.allowsReply = true;
    this.messager = messager;
    this.id = id;
  }
}

function MessageHandler(name, comObj) {
  this.name = name;
  this.comObj = comObj;
  this.callbackIndex = 1;
  var callbacks = this.callbacks = {};
  var ah = this.actionHandler = {};

  ah['console_log'] = [function ahConsoleLog(data) {
      console.log.apply(console, data);
  }];
  ah['console_error'] = [function ahConsoleError(data) {
      console.error.apply(console, data);
  }];

  comObj.onmessage = function messageHandlerComObjOnMessage(event) {
    var data = event.data;
    if (data.isReply) {
      var callbackId = data.callbackId;
      if (data.callbackId in callbacks) {
        var callback = callbacks[callbackId];
        delete callbacks[callbackId];
        callback(data.data);
      } else {
        throw 'Cannot resolve callback ' + callbackId;
      }
    } else if (data.action in ah) {
      var action = ah[data.action];
      var message = new Message(data.data);
      if (data.callbackId)
        message.setupReply(this.postMessage, data.callbackId);

      action[0].call(action[1], message);
    } else {
      throw 'Unkown action from worker: ' + data.action;
    }
  };
}

MessageHandler.prototype = {
  on: function messageHandlerOn(actionName, handler, scope) {
    var ah = this.actionHandler;
    if (ah[actionName]) {
      throw 'There is already an actionName called "' + actionName + '"';
    }
    ah[actionName] = [handler, scope];
  },

  send: function messageHandlerSend(actionName, data, callback) {
    var message = {
      action: actionName,
      data: data
    };
    if (callback) {
      var callbackId = this.callbackIndex++;
      this.callbacks[callbackId] = callback;
      message.callbackId = callbackId;
    }
    this.comObj.postMessage(message);
  }
};

var WorkerMessageHandler = {
  setup: function wphSetup(handler) {
    var pdfDoc = null;

    handler.on('test', function wphSetupTest(message) {
      var data = message.data;
      handler.send('test', data instanceof Uint8Array);
    });

    handler.on('workerSrc', function wphSetupWorkerSrc(data) {
      // In development, the `workerSrc` message is handled in the
      // `worker_loader.js` file. In production the workerProcessHandler is
      // called for this. This servers as a dummy to prevent calling an
      // undefined action `workerSrc`.
    });

    handler.on('doc', function wphSetupDoc(message) {
      var data = message.data;
      // Create only the model of the PDFDoc, which is enough for
      // processing the content of the pdf.
      pdfDoc = new PDFDocModel(new Stream(data));
    });

    handler.on('page_request', function wphSetupPageRequest(message) {
      var pageNum = message.data;
      pageNum = parseInt(pageNum);


      // The following code does quite the same as
      // Page.prototype.startRendering, but stops at one point and sends the
      // result back to the main thread.
      var gfx = new CanvasGraphics(null);

      var start = Date.now();

      var dependency = [];
      var IRQueue = null;
      try {
        var page = pdfDoc.getPage(pageNum);
        // Pre compile the pdf page and fetch the fonts/images.
        IRQueue = page.getIRQueue(handler, dependency);
      } catch (e) {
        // Turn the error into an obj that can be serialized
        e = {
          message: e.message,
          stack: e.stack
        };
        handler.send('page_error', {
          pageNum: pageNum,
          error: e
        });
        return;
      }

      console.log('page=%d - getIRQueue: time=%dms, len=%d', pageNum,
                                  Date.now() - start, IRQueue.fnArray.length);

      // Filter the dependecies for fonts.
      var fonts = {};
      for (var i = 0, ii = dependency.length; i < ii; i++) {
        var dep = dependency[i];
        if (dep.indexOf('font_') == 0) {
          fonts[dep] = true;
        }
      }

      handler.send('page', {
        pageNum: pageNum,
        IRQueue: IRQueue,
        depFonts: Object.keys(fonts)
      });
    }, this);

    handler.on('font', function wphSetupFont(message) {
      var data = message.data;
      var objId = data[0];
      var name = data[1];
      var file = data[2];
      var properties = data[3];

      var font = {
        name: name,
        file: file,
        properties: properties
      };

      // Some fonts don't have a file, e.g. the build in ones like Arial.
      if (file) {
        var fontFileDict = new Dict();
        fontFileDict.map = file.dict.map;

        var fontFile = new Stream(file.bytes, file.start,
                                  file.end - file.start, fontFileDict);

        // Check if this is a FlateStream. Otherwise just use the created
        // Stream one. This makes complex_ttf_font.pdf work.
        var cmf = file.bytes[0];
        if ((cmf & 0x0f) == 0x08) {
          font.file = new FlateStream(fontFile);
        } else {
          font.file = fontFile;
        }
      }

      var obj = new Font(font.name, font.file, font.properties);

      var str = '';
      var objData = obj.data;
      if (objData) {
        var length = objData.length;
        for (var j = 0; j < length; ++j)
          str += String.fromCharCode(objData[j]);
      }

      obj.str = str;

      // Remove the data array form the font object, as it's not needed
      // anymore as we sent over the ready str.
      delete obj.data;

      handler.send('font_ready', [objId, obj]);
    });
  }
};

var consoleTimer = {};

var workerConsole = {
  log: function log() {
    var args = Array.prototype.slice.call(arguments);
    postMessage({
      action: 'console_log',
      data: args
    });
  },

  error: function error() {
    var args = Array.prototype.slice.call(arguments);
    postMessage({
      action: 'console_error',
      data: args
    });
  },

  time: function time(name) {
    consoleTimer[name] = Date.now();
  },

  timeEnd: function timeEnd(name) {
    var time = consoleTimer[name];
    if (time == null) {
      throw 'Unkown timer name ' + name;
    }
    this.log('Timer:', name, Date.now() - time);
  }
};

// Worker thread?
if (typeof window === 'undefined') {
  globalScope.console = workerConsole;

  var handler = new MessageHandler('worker_processor', this);
  WorkerMessageHandler.setup(handler);
}

