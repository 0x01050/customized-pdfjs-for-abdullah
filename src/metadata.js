'use strict';

var Metadata = PDFJS.Metadata = (function MetadataClosure() {
  function Metadata(meta) {
    if (typeof meta === 'string') {
      var parser = new DOMParser();
      meta = parser.parseFromString(meta, 'application/xml');
    } else if (!(meta instanceof Document)) {
      error('Metadata: Invalid metadata object');
    }

    this.metaDocument = meta;
    this.metadata = {};
    this.parse();
  }

  Metadata.prototype = {
    parse: function() {
      var doc = this.metaDocument;
      var rdf = doc.documentElement;

      if (rdf.nodeName.toLowerCase() !== 'rdf:rdf') { // Wrapped in <xmpmeta>
        rdf = rdf.firstChild;
        while (rdf && rdf.nodeName.toLowerCase() !== 'rdf:rdf')
          rdf = rdf.nextSibling;
      }

      var nodeName = (rdf) ? rdf.nodeName.toLowerCase() : null;
      if (!rdf || nodeName !== 'rdf:rdf' || !rdf.hasChildNodes())
        return;

      var childNodes = rdf.childNodes, desc, namespace, entries, entry;

      for (var i = 0, length = childNodes.length; i < length; i++) {
        desc = childNodes[i];
        if (desc.nodeName.toLowerCase() !== 'rdf:description')
          continue;

        entries = [];
        for (var ii = 0, iLength = desc.childNodes.length; ii < iLength; ii++) {
          if (desc.childNodes[ii].nodeName.toLowerCase() !== '#text')
            entries.push(desc.childNodes[ii]);
        }

        for (ii = 0, iLength = entries.length; ii < iLength; ii++) {
          var entry = entries[ii];
          var name = entry.nodeName.toLowerCase();
          this.metadata[name] = entry.textContent.trim();
        }
      }
    },

    get: function(name) {
      return this.metadata[name] || null;
    },

    has: function(name) {
      return typeof this.metadata[name] !== 'undefined';
    }
  };

  return Metadata;
})();
