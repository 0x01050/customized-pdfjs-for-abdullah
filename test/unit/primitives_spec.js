/* Copyright 2017 Mozilla Foundation
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

import {
  Cmd,
  Dict,
  isCmd,
  isDict,
  isName,
  isRef,
  isRefsEqual,
  Name,
  Ref,
  RefSet,
} from "../../src/core/primitives.js";
import { XRefMock } from "./test_utils.js";

describe("primitives", function () {
  describe("Name", function () {
    it("should retain the given name", function () {
      const givenName = "Font";
      const name = Name.get(givenName);
      expect(name.name).toEqual(givenName);
    });

    it("should create only one object for a name and cache it", function () {
      const firstFont = Name.get("Font");
      const secondFont = Name.get("Font");
      const firstSubtype = Name.get("Subtype");
      const secondSubtype = Name.get("Subtype");

      expect(firstFont).toBe(secondFont);
      expect(firstSubtype).toBe(secondSubtype);
      expect(firstFont).not.toBe(firstSubtype);
    });
  });

  describe("Cmd", function () {
    it("should retain the given cmd name", function () {
      const givenCmd = "BT";
      const cmd = Cmd.get(givenCmd);
      expect(cmd.cmd).toEqual(givenCmd);
    });

    it("should create only one object for a command and cache it", function () {
      const firstBT = Cmd.get("BT");
      const secondBT = Cmd.get("BT");
      const firstET = Cmd.get("ET");
      const secondET = Cmd.get("ET");

      expect(firstBT).toBe(secondBT);
      expect(firstET).toBe(secondET);
      expect(firstBT).not.toBe(firstET);
    });
  });

  describe("Dict", function () {
    const checkInvalidHasValues = function (dict) {
      expect(dict.has()).toBeFalsy();
      expect(dict.has("Prev")).toBeFalsy();
    };

    const checkInvalidKeyValues = function (dict) {
      expect(dict.get()).toBeUndefined();
      expect(dict.get("Prev")).toBeUndefined();
      expect(dict.get("Decode", "D")).toBeUndefined();
      expect(dict.get("FontFile", "FontFile2", "FontFile3")).toBeUndefined();
    };

    let emptyDict, dictWithSizeKey, dictWithManyKeys;
    const storedSize = 42;
    const testFontFile = "file1";
    const testFontFile2 = "file2";
    const testFontFile3 = "file3";

    beforeAll(function (done) {
      emptyDict = new Dict();

      dictWithSizeKey = new Dict();
      dictWithSizeKey.set("Size", storedSize);

      dictWithManyKeys = new Dict();
      dictWithManyKeys.set("FontFile", testFontFile);
      dictWithManyKeys.set("FontFile2", testFontFile2);
      dictWithManyKeys.set("FontFile3", testFontFile3);

      done();
    });

    afterAll(function () {
      emptyDict = dictWithSizeKey = dictWithManyKeys = null;
    });

    it("should return invalid values for unknown keys", function () {
      checkInvalidHasValues(emptyDict);
      checkInvalidKeyValues(emptyDict);
    });

    it("should return correct value for stored Size key", function () {
      expect(dictWithSizeKey.has("Size")).toBeTruthy();

      expect(dictWithSizeKey.get("Size")).toEqual(storedSize);
      expect(dictWithSizeKey.get("Prev", "Size")).toEqual(storedSize);
      expect(dictWithSizeKey.get("Prev", "Root", "Size")).toEqual(storedSize);
    });

    it("should return invalid values for unknown keys when Size key is stored", function () {
      checkInvalidHasValues(dictWithSizeKey);
      checkInvalidKeyValues(dictWithSizeKey);
    });

    it("should not accept to set a key with an undefined value", function () {
      const dict = new Dict();
      expect(function () {
        dict.set("Size");
      }).toThrow(new Error('Dict.set: The "value" cannot be undefined.'));

      expect(dict.has("Size")).toBeFalsy();

      checkInvalidKeyValues(dict);
    });

    it("should return correct values for multiple stored keys", function () {
      expect(dictWithManyKeys.has("FontFile")).toBeTruthy();
      expect(dictWithManyKeys.has("FontFile2")).toBeTruthy();
      expect(dictWithManyKeys.has("FontFile3")).toBeTruthy();

      expect(dictWithManyKeys.get("FontFile3")).toEqual(testFontFile3);
      expect(dictWithManyKeys.get("FontFile2", "FontFile3")).toEqual(
        testFontFile2
      );
      expect(
        dictWithManyKeys.get("FontFile", "FontFile2", "FontFile3")
      ).toEqual(testFontFile);
    });

    it("should asynchronously fetch unknown keys", function (done) {
      const keyPromises = [
        dictWithManyKeys.getAsync("Size"),
        dictWithSizeKey.getAsync("FontFile", "FontFile2", "FontFile3"),
      ];

      Promise.all(keyPromises)
        .then(function (values) {
          expect(values[0]).toBeUndefined();
          expect(values[1]).toBeUndefined();
          done();
        })
        .catch(function (reason) {
          done.fail(reason);
        });
    });

    it("should asynchronously fetch correct values for multiple stored keys", function (done) {
      const keyPromises = [
        dictWithManyKeys.getAsync("FontFile3"),
        dictWithManyKeys.getAsync("FontFile2", "FontFile3"),
        dictWithManyKeys.getAsync("FontFile", "FontFile2", "FontFile3"),
      ];

      Promise.all(keyPromises)
        .then(function (values) {
          expect(values[0]).toEqual(testFontFile3);
          expect(values[1]).toEqual(testFontFile2);
          expect(values[2]).toEqual(testFontFile);
          done();
        })
        .catch(function (reason) {
          done.fail(reason);
        });
    });

    it("should callback for each stored key", function () {
      const callbackSpy = jasmine.createSpy("spy on callback in dictionary");

      dictWithManyKeys.forEach(callbackSpy);

      expect(callbackSpy).toHaveBeenCalled();
      const callbackSpyCalls = callbackSpy.calls;
      expect(callbackSpyCalls.argsFor(0)).toEqual(["FontFile", testFontFile]);
      expect(callbackSpyCalls.argsFor(1)).toEqual(["FontFile2", testFontFile2]);
      expect(callbackSpyCalls.argsFor(2)).toEqual(["FontFile3", testFontFile3]);
      expect(callbackSpyCalls.count()).toEqual(3);
    });

    it("should handle keys pointing to indirect objects, both sync and async", function (done) {
      const fontRef = Ref.get(1, 0);
      const xref = new XRefMock([{ ref: fontRef, data: testFontFile }]);
      const fontDict = new Dict(xref);
      fontDict.set("FontFile", fontRef);

      expect(fontDict.getRaw("FontFile")).toEqual(fontRef);
      expect(fontDict.get("FontFile", "FontFile2", "FontFile3")).toEqual(
        testFontFile
      );

      fontDict
        .getAsync("FontFile", "FontFile2", "FontFile3")
        .then(function (value) {
          expect(value).toEqual(testFontFile);
          done();
        })
        .catch(function (reason) {
          done.fail(reason);
        });
    });

    it("should handle arrays containing indirect objects", function () {
      const minCoordRef = Ref.get(1, 0);
      const maxCoordRef = Ref.get(2, 0);
      const minCoord = 0;
      const maxCoord = 1;
      const xref = new XRefMock([
        { ref: minCoordRef, data: minCoord },
        { ref: maxCoordRef, data: maxCoord },
      ]);
      const xObjectDict = new Dict(xref);
      xObjectDict.set("BBox", [minCoord, maxCoord, minCoordRef, maxCoordRef]);

      expect(xObjectDict.get("BBox")).toEqual([
        minCoord,
        maxCoord,
        minCoordRef,
        maxCoordRef,
      ]);
      expect(xObjectDict.getArray("BBox")).toEqual([
        minCoord,
        maxCoord,
        minCoord,
        maxCoord,
      ]);
    });

    it("should get all key names", function () {
      const expectedKeys = ["FontFile", "FontFile2", "FontFile3"];
      const keys = dictWithManyKeys.getKeys();

      expect(keys.sort()).toEqual(expectedKeys);
    });

    it("should create only one object for Dict.empty", function () {
      const firstDictEmpty = Dict.empty;
      const secondDictEmpty = Dict.empty;

      expect(firstDictEmpty).toBe(secondDictEmpty);
      expect(firstDictEmpty).not.toBe(emptyDict);
    });

    it("should correctly merge dictionaries", function () {
      const expectedKeys = ["FontFile", "FontFile2", "FontFile3", "Size"];

      const fontFileDict = new Dict();
      fontFileDict.set("FontFile", "Type1 font file");
      const mergedDict = Dict.merge(null, [
        dictWithManyKeys,
        dictWithSizeKey,
        fontFileDict,
      ]);
      const mergedKeys = mergedDict.getKeys();

      expect(mergedKeys.sort()).toEqual(expectedKeys);
      expect(mergedDict.get("FontFile")).toEqual(testFontFile);
    });
  });

  describe("Ref", function () {
    it("should retain the stored values", function () {
      const storedNum = 4;
      const storedGen = 2;
      const ref = Ref.get(storedNum, storedGen);
      expect(ref.num).toEqual(storedNum);
      expect(ref.gen).toEqual(storedGen);
    });
  });

  describe("RefSet", function () {
    it("should have a stored value", function () {
      const ref = Ref.get(4, 2);
      const refset = new RefSet();
      refset.put(ref);
      expect(refset.has(ref)).toBeTruthy();
    });
    it("should not have an unknown value", function () {
      const ref = Ref.get(4, 2);
      const refset = new RefSet();
      expect(refset.has(ref)).toBeFalsy();

      refset.put(ref);
      const anotherRef = Ref.get(2, 4);
      expect(refset.has(anotherRef)).toBeFalsy();
    });
  });

  describe("isName", function () {
    it("handles non-names", function () {
      const nonName = {};
      expect(isName(nonName)).toEqual(false);
    });

    it("handles names", function () {
      const name = Name.get("Font");
      expect(isName(name)).toEqual(true);
    });

    it("handles names with name check", function () {
      const name = Name.get("Font");
      expect(isName(name, "Font")).toEqual(true);
      expect(isName(name, "Subtype")).toEqual(false);
    });
  });

  describe("isCmd", function () {
    it("handles non-commands", function () {
      const nonCmd = {};
      expect(isCmd(nonCmd)).toEqual(false);
    });

    it("handles commands", function () {
      const cmd = Cmd.get("BT");
      expect(isCmd(cmd)).toEqual(true);
    });

    it("handles commands with cmd check", function () {
      const cmd = Cmd.get("BT");
      expect(isCmd(cmd, "BT")).toEqual(true);
      expect(isCmd(cmd, "ET")).toEqual(false);
    });
  });

  describe("isDict", function () {
    it("handles non-dictionaries", function () {
      const nonDict = {};
      expect(isDict(nonDict)).toEqual(false);
    });

    it("handles empty dictionaries with type check", function () {
      const dict = Dict.empty;
      expect(isDict(dict)).toEqual(true);
      expect(isDict(dict, "Page")).toEqual(false);
    });

    it("handles dictionaries with type check", function () {
      const dict = new Dict();
      dict.set("Type", Name.get("Page"));
      expect(isDict(dict, "Page")).toEqual(true);
      expect(isDict(dict, "Contents")).toEqual(false);
    });
  });

  describe("isRef", function () {
    it("handles non-refs", function () {
      const nonRef = {};
      expect(isRef(nonRef)).toEqual(false);
    });

    it("handles refs", function () {
      const ref = Ref.get(1, 0);
      expect(isRef(ref)).toEqual(true);
    });
  });

  describe("isRefsEqual", function () {
    it("should handle Refs pointing to the same object", function () {
      const ref1 = Ref.get(1, 0);
      const ref2 = Ref.get(1, 0);
      expect(isRefsEqual(ref1, ref2)).toEqual(true);
    });

    it("should handle Refs pointing to different objects", function () {
      const ref1 = Ref.get(1, 0);
      const ref2 = Ref.get(2, 0);
      expect(isRefsEqual(ref1, ref2)).toEqual(false);
    });
  });
});
