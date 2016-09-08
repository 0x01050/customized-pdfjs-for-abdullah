/* Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('pdfjs-web/annotation_layer_builder', ['exports',
      'pdfjs-web/ui_utils', 'pdfjs-web/pdf_link_service',
      'pdfjs-web/pdfjs'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports, require('./ui_utils.js'),
      require('./pdf_link_service.js'), require('./pdfjs.js'));
  } else {
    factory((root.pdfjsWebAnnotationLayerBuilder = {}), root.pdfjsWebUIUtils,
      root.pdfjsWebPDFLinkService, root.pdfjsWebPDFJS);
  }
}(this, function (exports, uiUtils, pdfLinkService, pdfjsLib) {

var mozL10n = uiUtils.mozL10n;
var SimpleLinkService = pdfLinkService.SimpleLinkService;

/**
 * @typedef {Object} AnnotationLayerBuilderOptions
 * @property {HTMLDivElement} pageDiv
 * @property {PDFPage} pdfPage
 * @property {IPDFLinkService} linkService
 * @property {DownloadManager} downloadManager
 */

/**
 * @class
 */
var AnnotationLayerBuilder = (function AnnotationLayerBuilderClosure() {
  /**
   * @param {AnnotationLayerBuilderOptions} options
   * @constructs AnnotationLayerBuilder
   */
  function AnnotationLayerBuilder(options) {
    this.pageDiv = options.pageDiv;
    this.pdfPage = options.pdfPage;
    this.linkService = options.linkService;
    this.downloadManager = options.downloadManager;

    this.div = null;
  }

  AnnotationLayerBuilder.prototype =
      /** @lends AnnotationLayerBuilder.prototype */ {

    /**
     * @param {PageViewport} viewport
     * @param {string} intent (default value is 'display')
     */
    render: function AnnotationLayerBuilder_render(viewport, intent) {
      var self = this;
      var parameters = {
        intent: (intent === undefined ? 'display' : intent),
      };

      this.pdfPage.getAnnotations(parameters).then(function (annotations) {
        viewport = viewport.clone({ dontFlip: true });
        parameters = {
          viewport: viewport,
          div: self.div,
          annotations: annotations,
          page: self.pdfPage,
          linkService: self.linkService,
          downloadManager: self.downloadManager,
          renderInteractiveForms: pdfjsLib.PDFJS.renderInteractiveForms,
        };

        if (self.div) {
          // If an annotationLayer already exists, refresh its children's
          // transformation matrices.
          pdfjsLib.AnnotationLayer.update(parameters);
        } else {
          // Create an annotation layer div and render the annotations
          // if there is at least one annotation.
          if (annotations.length === 0) {
            return;
          }

          self.div = document.createElement('div');
          self.div.className = 'annotationLayer';
          self.pageDiv.appendChild(self.div);
          parameters.div = self.div;

          pdfjsLib.AnnotationLayer.render(parameters);
          if (typeof mozL10n !== 'undefined') {
            mozL10n.translate(self.div);
          }
        }
      });
    },

    hide: function AnnotationLayerBuilder_hide() {
      if (!this.div) {
        return;
      }
      this.div.setAttribute('hidden', 'true');
    }
  };

  return AnnotationLayerBuilder;
})();

/**
 * @constructor
 * @implements IPDFAnnotationLayerFactory
 */
function DefaultAnnotationLayerFactory() {}
DefaultAnnotationLayerFactory.prototype = {
  /**
   * @param {HTMLDivElement} pageDiv
   * @param {PDFPage} pdfPage
   * @returns {AnnotationLayerBuilder}
   */
  createAnnotationLayerBuilder: function (pageDiv, pdfPage) {
    return new AnnotationLayerBuilder({
      pageDiv: pageDiv,
      pdfPage: pdfPage,
      linkService: new SimpleLinkService(),
    });
  }
};

exports.AnnotationLayerBuilder = AnnotationLayerBuilder;
exports.DefaultAnnotationLayerFactory = DefaultAnnotationLayerFactory;
}));
