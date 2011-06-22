"use strict";

function WorkerPDFDoc(canvas) {
  var timer = null
  function tic() {
    timer = Date.now();
  }

  function toc(msg) {
    console.log(msg + ": " + (Date.now() - timer) + "ms");
  }

  this.ctx = canvas.getContext("2d");
  this.canvas = canvas;
  this.worker = new Worker('worker.js');

  this.numPage = 1;
  this.numPages = null;

  var imagesList = {};
  var canvasList = {
    0: canvas
  };
  var patternList = {};
  var gradient;

  var currentX = 0;
  var currentXStack = [];

  var ctxSpecial = {
    "$setCurrentX": function(value) {
      currentX = value;
    },

    "$addCurrentX": function(value) {
      currentX += value;
    },

    "$saveCurrentX": function() {
      currentXStack.push(currentX);
    },

    "$restoreCurrentX": function() {
      currentX = currentXStack.pop();
    },

    "$showText": function(y, text, uniText) {
      this.translate(currentX, -1 * y);
      this.fillText(uniText, 0, 0);
      currentX += this.measureText(text).width;
    },

    "$putImageData": function(imageData, x, y) {
      var imgData = this.getImageData(0, 0, imageData.width, imageData.height);

      // Store the .data property to avaid property lookups.
      var imageRealData = imageData.data;
      var imgRealData = imgData.data;

      // Copy over the imageData.
      var len = imageRealData.length;
      while (len--)
      imgRealData[len] = imageRealData[len]

      this.putImageData(imgData, x, y);
    },

    "$drawImage": function(id, x, y, sx, sy, swidth, sheight) {
      var image = imagesList[id];
      if (!image) {
        throw "Image not found";
      }
      this.drawImage(image, x, y, image.width, image.height,
        sx, sy, swidth, sheight);
    },

    "$drawCanvas": function(id, x, y, sx, sy, swidth, sheight) {
      var canvas = canvasList[id];
      if (!canvas) {
        throw "Canvas not found";
      }
      if (sheight != null) {
        this.drawImage(canvas, x, y, canvas.width, canvas.height,
          sx, sy, swidth, sheight);
      } else {
        this.drawImage(canvas, x, y, canvas.width, canvas.height);
      }
    },

    "$createLinearGradient": function(x0, y0, x1, y1) {
      gradient = this.createLinearGradient(x0, y0, x1, y1);
    },

    "$createPatternFromCanvas": function(patternId, canvasId, kind) {
      var canvas = canvasList[canvasId];
      if (!canvas) {
        throw "Canvas not found";
      }
      patternList[patternId] = this.createPattern(canvas, kind);
    },

    "$addColorStop": function(i, rgba) {
      gradient.addColorStop(i, rgba);
    },

    "$fillStyleGradient": function() {
      this.fillStyle = gradient;
    },

    "$fillStylePattern": function(id) {
      var pattern = patternList[id];
      if (!pattern) {
        throw "Pattern not found";
      }
      this.fillStyle = pattern;
    },

    "$strokeStyleGradient": function() {
      this.strokeStyle = gradient;
    },

    "$strokeStylePattern": function(id) {
      var pattern = patternList[id];
      if (!pattern) {
        throw "Pattern not found";
      }
      this.strokeStyle = pattern;
    }
  }

  function renderProxyCanvas(canvas, stack) {
    var ctx = canvas.getContext("2d");
    for (var i = 0; i < stack.length; i++) {
      var opp = stack[i];
      if (opp[0] == "$") {
        ctx[opp[1]] = opp[2];
      } else if (opp[0] in ctxSpecial) {
        ctxSpecial[opp[0]].apply(ctx, opp[1]);
      } else {
        ctx[opp[0]].apply(ctx, opp[1]);
      }
    }
  }

  /**
  * onMessage state machine.
  */
  const WAIT = 0;
  const CANVAS_PROXY_STACK = 1;
  const LOG = 2;
  const FONT = 3;
  const PDF_NUM_PAGE = 4;
  const JPEG_STREAM = 5;

  var onMessageState = WAIT;
  this.worker.onmessage = function(event) {
    var data = event.data;
    // console.log("onMessageRaw", data);
    switch (onMessageState) {
      case WAIT:
        if (typeof data != "string") {
          throw "expecting to get an string";
        }
        switch (data) {
          case "pdf_num_page":
            onMessageState = PDF_NUM_PAGE;
            return;

          case "log":
            onMessageState = LOG;
            return;

          case "canvas_proxy_stack":
            onMessageState = CANVAS_PROXY_STACK;
            return;

          case "font":
            onMessageState = FONT;
            return;

          case "jpeg_stream":
            onMessageState = JPEG_STREAM;
            return;

          default:
            throw "unkown state: " + data
        }
      break;

      case JPEG_STREAM:
        var img = new Image();
        img.src = "data:image/jpeg;base64," + window.btoa(data.str);
        imagesList[data.id] = img;
        console.log("got image", data.id)
      break;

      case PDF_NUM_PAGE:
        this.numPages = parseInt(data);
        if (this.loadCallback) {
          this.loadCallback();
        }
        onMessageState = WAIT;
      break;

      case FONT:
        data = JSON.parse(data);
        var base64 = window.btoa(data.str);

        // Add the @font-face rule to the document
        var url = "url(data:" + data.mimetype + ";base64," + base64 + ");";
        var rule = "@font-face { font-family:'" + data.fontName + "';src:" + url + "}";
        var styleSheet = document.styleSheets[0];
        styleSheet.insertRule(rule, styleSheet.length);

        // Just adding the font-face to the DOM doesn't make it load. It
        // seems it's loaded once Gecko notices it's used. Therefore,
        // add a div on the page using the loaded font.
        document.getElementById("fonts").innerHTML += "<div style='font-family:" + data.fontName + "'>j</div>";

        onMessageState = WAIT;
      break;

      case LOG:
        console.log.apply(console, JSON.parse(data));
        onMessageState = WAIT;
      break;

      case CANVAS_PROXY_STACK:
        var id = data.id;
        var stack = data.stack;

        // Check if there is already a canvas with the given id. If not,
        // create a new canvas.
        if (!canvasList[id]) {
          var newCanvas = document.createElement("canvas");
          newCanvas.width = data.width;
          newCanvas.height = data.height;
          canvasList[id] = newCanvas;
        }

        // There might be fonts that need to get loaded. Shedule the
        // rendering at the end of the event queue ensures this.
        setTimeout(function() {
          if (id == 0) tic();
          renderProxyCanvas(canvasList[id], stack);
          if (id == 0) toc("canvas rendering")
        }, 0);
        onMessageState = WAIT;
      break;
    }
  }.bind(this);
}

  WorkerPDFDoc.prototype.open = function(url, callback) {
  var req = new XMLHttpRequest();
  req.open("GET", url);
  req.mozResponseType = req.responseType = "arraybuffer";
  req.expected = (document.URL.indexOf("file:") == 0) ? 0 : 200;
  req.onreadystatechange = function() {
    if (req.readyState == 4 && req.status == req.expected) {
      var data = req.mozResponseArrayBuffer || req.mozResponse ||
      req.responseArrayBuffer || req.response;

      this.loadCallback = callback;
      this.worker.postMessage(data);
      this.showPage(this.numPage);
    }
  }.bind(this);
  req.send(null);
}

WorkerPDFDoc.prototype.showPage = function(numPage) {
  var ctx = this.ctx;
  ctx.save();
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  this.numPage = parseInt(numPage);
  this.worker.postMessage(numPage);
  if (this.onChangePage) {
    this.onChangePage(numPage);
  }
}

WorkerPDFDoc.prototype.nextPage = function() {
  if (this.numPage == this.numPages) return;
  this.showPage(++this.numPage);
}

WorkerPDFDoc.prototype.prevPage = function() {
  if (this.numPage == 1) return;
  this.showPage(--this.numPage);
}
