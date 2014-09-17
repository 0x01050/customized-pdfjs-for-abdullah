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
 /*globals DEFAULT_PREFERENCES */

'use strict';

var EXPORTED_SYMBOLS = ['PdfjsChromeUtils'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const PREF_PREFIX = 'pdfjs';
const PDF_CONTENT_TYPE = 'application/pdf';

Cu.import('resource://gre/modules/XPCOMUtils.jsm');
Cu.import('resource://gre/modules/Services.jsm');

XPCOMUtils.defineLazyModuleGetter(this, "BrowserUtils",
                                  "resource://gre/modules/BrowserUtils.jsm");

let Svc = {};
XPCOMUtils.defineLazyServiceGetter(Svc, 'mime',
                                   '@mozilla.org/mime;1',
                                   'nsIMIMEService');

//#include ../../../web/default_preferences.js

let PdfjsChromeUtils = {
  // For security purposes when running remote, we restrict preferences
  // content can access.
  _allowedPrefNames: Object.keys(DEFAULT_PREFERENCES),
  _ppmm: null,
  _mmg: null,

  /*
   * Public API
   */

  init: function () {
    if (!this._ppmm) {
      // global parent process message manager (PPMM)
      this._ppmm = Cc["@mozilla.org/parentprocessmessagemanager;1"].getService(Ci.nsIMessageBroadcaster);
      this._ppmm.addMessageListener("PDFJS:Parent:clearUserPref", this);
      this._ppmm.addMessageListener("PDFJS:Parent:setIntPref", this);
      this._ppmm.addMessageListener("PDFJS:Parent:setBoolPref", this);
      this._ppmm.addMessageListener("PDFJS:Parent:setCharPref", this);
      this._ppmm.addMessageListener("PDFJS:Parent:setStringPref", this);
      this._ppmm.addMessageListener("PDFJS:Parent:isDefaultHandlerApp", this);

      // global dom message manager (MMg)
      this._mmg = Cc["@mozilla.org/globalmessagemanager;1"].getService(Ci.nsIMessageListenerManager);
      this._mmg.addMessageListener("PDFJS:Parent:getChromeWindow", this);
      this._mmg.addMessageListener("PDFJS:Parent:getFindBar", this);
      this._mmg.addMessageListener("PDFJS:Parent:displayWarning", this);

      // observer to handle shutdown
      Services.obs.addObserver(this, "quit-application", false);
    }
  },

  uninit: function () {
    if (this._ppmm) {
      this._ppmm.removeMessageListener("PDFJS:Parent:clearUserPref", this);
      this._ppmm.removeMessageListener("PDFJS:Parent:setIntPref", this);
      this._ppmm.removeMessageListener("PDFJS:Parent:setBoolPref", this);
      this._ppmm.removeMessageListener("PDFJS:Parent:setCharPref", this);
      this._ppmm.removeMessageListener("PDFJS:Parent:setStringPref", this);
      this._ppmm.removeMessageListener("PDFJS:Parent:isDefaultHandlerApp", this);

      this._mmg.removeMessageListener("PDFJS:Parent:getChromeWindow", this);
      this._mmg.removeMessageListener("PDFJS:Parent:getFindBar", this);
      this._mmg.removeMessageListener("PDFJS:Parent:displayWarning", this);

      Services.obs.removeObserver(this, "quit-application", false);

      this._mmg = null;
      this._ppmm = null;
    }
  },

  /*
   * Called by the main module when preference changes are picked up
   * in the parent process. Observers don't propagate so we need to
   * instruct the child to refresh its configuration and (possibly)
   * the module's registration.
   */
  notifyChildOfSettingsChange: function () {
    if (Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_DEFAULT &&
        this._ppmm) {
      // XXX kinda bad, we want to get the parent process mm associated
      // with the content process. _ppmm is currently the global process
      // manager, which means this is going to fire to every child process
      // we have open. Unfortunately I can't find a way to get at that
      // process specific mm from js.
      this._ppmm.broadcastAsyncMessage("PDFJS:Child:refreshSettings", {});
    }
  },

  /*
   * Events
   */

  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "quit-application") {
      this.uninit();
    }
  },

  receiveMessage: function (aMsg) {
    switch (aMsg.name) {
      case "PDFJS:Parent:clearUserPref":
        this._clearUserPref(aMsg.json.name);
        break;
      case "PDFJS:Parent:setIntPref":
        this._setIntPref(aMsg.json.name, aMsg.json.value);
        break;
      case "PDFJS:Parent:setBoolPref":
        this._setBoolPref(aMsg.json.name, aMsg.json.value);
        break;
      case "PDFJS:Parent:setCharPref":
        this._setCharPref(aMsg.json.name, aMsg.json.value);
        break;
      case "PDFJS:Parent:setStringPref":
        this._setStringPref(aMsg.json.name, aMsg.json.value);
        break;
      case "PDFJS:Parent:isDefaultHandlerApp":
        return this.isDefaultHandlerApp();
      case "PDFJS:Parent:displayWarning":
        this._displayWarning(aMsg);
        break;

      // CPOW getters
      case "PDFJS:Parent:getChromeWindow":
        return this._getChromeWindow(aMsg);
      case "PDFJS:Parent:getFindBar":
        return this._getFindBar(aMsg);
    }
  },

  /*
   * Internal
   */

  _getChromeWindow: function (aMsg) {
    // See the child module, our return result here can't be the element
    // since return results don't get auto CPOW'd.
    let browser = aMsg.target;
    let wrapper = new PdfjsWindowWrapper(browser);
    let suitcase = aMsg.objects.suitcase;
    suitcase.setChromeWindow(wrapper);
    return true;
  },

  _getFindBar: function (aMsg) {
    // We send this over via the window's message manager, so target should
    // be the dom window.
    let browser = aMsg.target;
    let wrapper = new PdfjsFindbarWrapper(browser);
    let suitcase = aMsg.objects.suitcase;
    suitcase.setFindBar(wrapper);
    return true;
  },

  _isPrefAllowed: function (aPrefName) {
    if (this._allowedPrefNames.indexOf(aPrefName) == -1) {
      let msg = "'" + aPrefName + "' ";
      msg += "can't be accessed from content. See PdfjsChromeUtils." 
      throw new Error(msg);
    }
  },

  _clearUserPref: function (aPrefName) {
    this._isPrefAllowed(aPrefName);
    Services.prefs.clearUserPref(aPrefName);
  },

  _setIntPref: function (aPrefName, aPrefValue) {
    this._isPrefAllowed(aPrefName);
    Services.prefs.setIntPref(aPrefName, aPrefValue);
  },

  _setBoolPref: function (aPrefName, aPrefValue) {
    this._isPrefAllowed(aPrefName);
    Services.prefs.setBoolPref(aPrefName, aPrefValue);
  },

  _setCharPref: function (aPrefName, aPrefValue) {
    this._isPrefAllowed(aPrefName);
    Services.prefs.setCharPref(aPrefName, aPrefValue);
  },

  _setStringPref: function (aPrefName, aPrefValue) {
    this._isPrefAllowed(aPrefName);
    let str = Cc['@mozilla.org/supports-string;1']
                .createInstance(Ci.nsISupportsString);
    str.data = aPrefValue;
    Services.prefs.setComplexValue(aPrefName, Ci.nsISupportsString, str);
  },

  /*
   * Svc.mime doesn't have profile information in the child, so
   * we bounce this pdfjs enabled configuration check over to the
   * parent.
   */
  isDefaultHandlerApp: function () {
    var handlerInfo = Svc.mime.getFromTypeAndExtension(PDF_CONTENT_TYPE, 'pdf');
    return !handlerInfo.alwaysAskBeforeHandling &&
           handlerInfo.preferredAction == Ci.nsIHandlerInfo.handleInternally;
  },

  /*
   * Display a notification warning when the renderer isn't sure
   * a pdf displayed correctly.
   */
  _displayWarning: function (aMsg) {
    let json = aMsg.json;
    let browser = aMsg.target;
    let cpowCallback = aMsg.objects.callback;
    let tabbrowser = browser.getTabBrowser();
    let notificationBox = tabbrowser.getNotificationBox(browser);
    // Flag so we don't call the response callback twice, since if the user
    // clicks open with different viewer both the button callback and
    // eventCallback will be called.
    let responseSent = false;
    let buttons = [{
      label: json.label,
      accessKey: json.accessKey,
      callback: function() {
        responseSent = true;
        cpowCallback(true);
      }
    }];
    notificationBox.appendNotification(json.message, 'pdfjs-fallback', null,
                                       notificationBox.PRIORITY_INFO_LOW,
                                       buttons,
                                       function eventsCallback(eventType) {
      // Currently there is only one event "removed" but if there are any other
      // added in the future we still only care about removed at the moment.
      if (eventType !== 'removed') {
        return;
      }
      // Don't send a response again if we already responded when the button was
      // clicked.
      if (responseSent) {
        return;
      }
      cpowCallback(false);
    });
  }
};

/*
 * CPOW security features require chrome objects declare exposed
 * properties via __exposedProps__. We don't want to expose things
 * directly on the findbar, so we wrap the findbar in a smaller
 * object here that supports the features pdf.js needs.
 */
function PdfjsFindbarWrapper(aBrowser) {
  let tabbrowser = aBrowser.getTabBrowser();
  let tab = tabbrowser._getTabForBrowser(aBrowser);
  this._findbar = tabbrowser.getFindBar(tab);
};

PdfjsFindbarWrapper.prototype = {
  __exposedProps__: {
    addEventListener: "r",
    removeEventListener: "r",
    updateControlState: "r",
  },
  _findbar: null,

  updateControlState: function (aResult, aFindPrevious) {
    this._findbar.updateControlState(aResult, aFindPrevious);
  },

  addEventListener: function (aType, aListener, aUseCapture, aWantsUntrusted) {
    this._findbar.addEventListener(aType, aListener, aUseCapture, aWantsUntrusted);
  },

  removeEventListener: function (aType, aListener, aUseCapture) {
    this._findbar.removeEventListener(aType, aListener, aUseCapture);
  }
};

function PdfjsWindowWrapper(aBrowser) {
  this._window = aBrowser.ownerDocument.defaultView;
};

PdfjsWindowWrapper.prototype = {
  __exposedProps__: {
    valueOf: "r",
  },
  _window: null,

  valueOf: function () {
    return this._window.valueOf();
  }
};

