/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Copyright 2012 Mozilla Foundation
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
/* globals PDFView, mozL10n */

'use strict';

var DocumentProperties = {
  overlayContainer: null,
  fileSize: '',
  visible: false,

  // Document property fields (in the viewer).
  fileNameField: null,
  fileSizeField: null,
  titleField: null,
  authorField: null,
  subjectField: null,
  keywordsField: null,
  creationDateField: null,
  modificationDateField: null,
  creatorField: null,
  producerField: null,
  versionField: null,
  pageCountField: null,

  initialize: function documentPropertiesInitialize(options) {
    this.overlayContainer = options.overlayContainer;

    // Set the document property fields.
    this.fileNameField = options.fileNameField;
    this.fileSizeField = options.fileSizeField;
    this.titleField = options.titleField;
    this.authorField = options.authorField;
    this.subjectField = options.subjectField;
    this.keywordsField = options.keywordsField;
    this.creationDateField = options.creationDateField;
    this.modificationDateField = options.modificationDateField;
    this.creatorField = options.creatorField;
    this.producerField = options.producerField;
    this.versionField = options.versionField;
    this.pageCountField = options.pageCountField;

    // Bind the event listener for the Close button.
    if (options.closeButton) {
      options.closeButton.addEventListener('click', this.hide.bind(this));
    }
  },

  getProperties: function documentPropertiesGetProperties() {
    var self = this;

    // Get the file size.
    PDFView.pdfDocument.dataLoaded().then(function(data) {
      self.setFileSize(data.length);
    });

    // Get the other document properties.
    PDFView.pdfDocument.getMetadata().then(function(data) {
      var fields = [
        { field: self.fileNameField, content: PDFView.url },
        { field: self.fileSizeField, content: self.fileSize },
        { field: self.titleField, content: data.info.Title },
        { field: self.authorField, content: data.info.Author },
        { field: self.subjectField, content: data.info.Subject },
        { field: self.keywordsField, content: data.info.Keywords },
        { field: self.creationDateField,
          content: self.parseDate(data.info.CreationDate) },
        { field: self.modificationDateField,
          content: self.parseDate(data.info.ModDate) },
        { field: self.creatorField, content: data.info.Creator },
        { field: self.producerField, content: data.info.Producer },
        { field: self.versionField, content: data.info.PDFFormatVersion },
        { field: self.pageCountField, content: PDFView.pdfDocument.numPages }
      ];

      // Show the properties in the dialog.
      for (var item in fields) {
        var element = fields[item];
        if (element.field && element.content !== undefined &&
            element.content !== '') {
          element.field.textContent = element.content;
        }
      }
    });
  },

  setFileSize: function documentPropertiesSetFileSize(fileSize) {
    var kb = Math.round(fileSize / 1024);
    if (kb < 1024) {
      this.fileSize = mozL10n.get('document_properties_kb',
                                  {size_kb: kb}, '{{size_kb}} KB');
    } else {
      var mb = Math.round((kb / 1024) * 100) / 100;
      this.fileSize = mozL10n.get('document_properties_mb',
                                  {size_mb: mb}, '{{size_mb}} MB');
    }
  },

  show: function documentPropertiesShow() {
    if (this.visible) {
      return;
    }
    this.visible = true;
    this.overlayContainer.classList.remove('hidden');
    this.overlayContainer.lastElementChild.classList.remove('hidden');
    this.getProperties();
  },

  hide: function documentPropertiesClose() {
    if (!this.visible) {
      return;
    }
    this.visible = false;
    this.overlayContainer.classList.add('hidden');
    this.overlayContainer.lastElementChild.classList.add('hidden');
  },

  parseDate: function documentPropertiesParseDate(inputDate) {
    // This is implemented according to the PDF specification (see
    // http://www.gnupdf.org/Date for an overview), but note that 
    // Adobe Reader doesn't handle changing the date to universal time
    // and doesn't use the user's time zone (they're effectively ignoring
    // the HH' and mm' parts of the date string).
    var dateToParse = inputDate;
    if (dateToParse === undefined) {
      return '';
    }

    // Remove the D: prefix if it is available.
    if (dateToParse.substring(0,2) === 'D:') {
      dateToParse = dateToParse.substring(2);
    }

    // Get all elements from the PDF date string.
    // JavaScript's Date object expects the month to be between
    // 0 and 11 instead of 1 and 12, so we're correcting for this.
    var year = parseInt(dateToParse.substring(0,4), 10);
    var month = parseInt(dateToParse.substring(4,6), 10) - 1;
    var day = parseInt(dateToParse.substring(6,8), 10);
    var hours = parseInt(dateToParse.substring(8,10), 10);
    var minutes = parseInt(dateToParse.substring(10,12), 10);
    var seconds = parseInt(dateToParse.substring(12,14), 10);
    var utRel = dateToParse.substring(14,15);
    var offsetHours = parseInt(dateToParse.substring(15,17), 10);
    var offsetMinutes = parseInt(dateToParse.substring(18,20), 10);

    // As per spec, utRel = 'Z' means equal to universal time.
    // The other cases ('-' and '+') have to be handled here.
    if (utRel == '-') {
      hours += offsetHours;
      minutes += offsetMinutes;
    } else if (utRel == '+') {
      hours -= offsetHours;
      minutes += offsetMinutes;
    }

    // Return the new date format from the user's locale.
    var date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    var dateString = date.toLocaleDateString();
    var timeString = date.toLocaleTimeString();
    return mozL10n.get('document_properties_date_string',
                       {date: dateString, time: timeString},
                       '{{date}}, {{time}}');
  }
};
